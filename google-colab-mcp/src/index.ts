#!/usr/bin/env node
import 'dotenv/config'; // Ensure env vars are loaded (though MCP injects them too)
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {
	CallToolRequestSchema,
	ErrorCode,
	ListToolsRequestSchema,
	McpError,
	// We might need ReadResourceRequestSchema later if we add resources
    // McpRequest removed again
} from '@modelcontextprotocol/sdk/types.js'; // Removed McpRequest, McpResponse
import { google, Auth, drive_v3 } from 'googleapis'; // Import googleapis and specific types

// --- Google API Client Initialization ---
let drive: drive_v3.Drive;
let authClient: Auth.OAuth2Client;

function initializeGoogleAuth() {
	const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
	const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
	const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

	if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
		console.error(
			'FATAL ERROR: Missing Google API credentials in environment variables (GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN). Check MCP settings.'
		);
		// In a real server, might throw or exit, but MCP handles server restarts
		throw new Error('Missing Google API credentials');
	}

	authClient = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
	authClient.setCredentials({ refresh_token: REFRESH_TOKEN });

	// Set auth as default options for subsequent google API calls
	google.options({ auth: authClient });

	drive = google.drive({ version: 'v3', auth: authClient });
	console.error('Google Drive client initialized successfully.');
}


// --- Tool Input Schemas (Zod) ---
const ListFilesArgsSchema = z.object({
	// Google Drive uses file IDs or 'root' alias, not traditional paths for listing root/folders
	folderId: z.string().optional().describe("Optional Google Drive folder ID to list. Defaults to 'root'."),
    pageSize: z.number().int().positive().optional().default(100).describe("Maximum number of files to return."),
    pageToken: z.string().optional().describe("Page token for fetching subsequent pages."),
});

const ReadFileArgsSchema = z.object({
	fileId: z.string().describe('The Google Drive file ID of the file to read.'),
});

const WriteFileArgsSchema = z.object({
	fileName: z.string().describe('The desired name for the file on Google Drive.'),
	content: z.string().describe('The text content to write to the file.'),
	parentFolderId: z.string().optional().default('root').describe("Optional Google Drive folder ID where the file should be created. Defaults to 'root'."),
	mimeType: z.string().optional().default('text/plain').describe("MIME type for the file (e.g., 'text/plain', 'application/json', 'text/csv')."),
    // Overwriting requires finding existing file first, then updating. Simpler to just create new for now.
    // overwrite: z.boolean().optional().default(false).describe("Whether to overwrite the file if it already exists (requires searching by name first)."),
});

const AddCodeCellArgsSchema = z.object({
	notebookFileId: z.string().describe('The Google Drive file ID of the .ipynb notebook to modify.'),
	code: z.string().describe('The Python code to add in the new cell.'),
 position: z.number().int().nonnegative().optional().describe("Optional index to insert the cell at (0-based). Appends if omitted."),
});

const EditCodeCellArgsSchema = z.object({
 notebookFileId: z.string().describe('The Google Drive file ID of the .ipynb notebook to modify.'),
 cellIndex: z.number().int().nonnegative().describe('The 0-based index of the code cell to edit.'),
 newCode: z.string().describe('The new Python code content for the cell.'),
});

// --- Convert Zod Schemas to JSON Schemas ---
const listFilesJsonSchema = zodToJsonSchema(ListFilesArgsSchema, "listFilesJsonSchema");
const readFileJsonSchema = zodToJsonSchema(ReadFileArgsSchema, "readFileJsonSchema");
const writeFileJsonSchema = zodToJsonSchema(WriteFileArgsSchema, "writeFileJsonSchema");
const addCodeCellJsonSchema = zodToJsonSchema(AddCodeCellArgsSchema, "addCodeCellJsonSchema");
const editCodeCellJsonSchema = zodToJsonSchema(EditCodeCellArgsSchema, "editCodeCellJsonSchema");


class GoogleColabMcpServer {
    private server: Server;

    constructor() {
        this.server = new Server(
            {
                name: 'google-colab-mcp',
                version: '0.1.0',
            },
            {
                capabilities: {
                    // Resources can be added here if needed later
                    resources: {},
                    tools: {}, // Tools will be defined in setupToolHandlers
                },
            }
        );

        this.setupToolHandlers();

        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    private setupToolHandlers() {
        // --- List Tools Handler ---
        this.server.setRequestHandler(ListToolsRequestSchema, async () => {
   // Define the tools using the generated JSON schemas
   return {
    tools: [
     {
      name: 'list_files',
      description: "Lists files and folders within a specified folder in the user's Google Drive.",
      inputSchema: listFilesJsonSchema,
     },
     {
      name: 'read_file',
      description: "Reads the content of a specified file from the user's Google Drive using its file ID.",
      inputSchema: readFileJsonSchema,
     },
     {
      name: 'write_file',
      description: "Writes text content to a specified file name in the user's Google Drive, creating it if it doesn't exist.",
      inputSchema: writeFileJsonSchema,
     }, // End of write_file object
     { // Start of edit_code_cell object
      name: 'edit_code_cell',
      description: 'Edits the code content of a specific cell in a notebook by its index.',
      inputSchema: editCodeCellJsonSchema,
     }, // End of edit_code_cell object
     {
      name: 'add_code_cell',
      description: 'Adds a new code cell to a specified .ipynb notebook file (by file ID) on Google Drive.',
      inputSchema: addCodeCellJsonSchema,
     },
    ],
   };
  });

  // --- Call Tool Handler ---
  this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    return this.handleCallTool(request);
  });
 } // End of setupToolHandlers method

 // --- Separate method to handle tool calls ---
 private async handleCallTool(request: { params: { name: string; arguments?: any } }): Promise<any> { // Using proper type for request and any for response promise for now, SDK handles typing
  const toolName = request.params.name;
  const args = request.params.arguments;

  // Ensure Google Drive client is initialized
  if (!drive || !authClient) {
   // This check should ideally happen earlier, but good to have redundancy
   console.error('FATAL: Google Drive client accessed before initialization.');
   throw new McpError(ErrorCode.InternalError, 'Google Drive client not initialized.');
  }

  console.error(`Received call for tool: ${toolName} with args:`, args);

  switch (toolName) {
   case 'list_files':
    try {
     // 1. Validate arguments
     const validatedArgs = ListFilesArgsSchema.parse(args);
     const folderId = validatedArgs.folderId || 'root';
     const pageSize = validatedArgs.pageSize;
     const pageToken = validatedArgs.pageToken;

     console.error(`Listing files in folder: ${folderId}, pageSize: ${pageSize}, pageToken: ${pageToken}`);

     // 2. Call Google Drive API
     const response = await drive.files.list({
      pageSize: pageSize,
      pageToken: pageToken,
      q: `'${folderId}' in parents and trashed = false`, // List files/folders within the parent folder, excluding trashed items
      fields: 'nextPageToken, files(id, name, mimeType)', // Request specific fields
      orderBy: 'folder,name', // List folders first, then sort by name
     });

     // 3. Format response
     const files = response.data.files || [];
     const nextPageToken = response.data.nextPageToken;

     let resultText = `Files/Folders in '${folderId}':\n`;
     if (files.length === 0) {
      resultText += '- (No files or folders found)\n';
     } else {
      files.forEach((file) => {
       const type = file.mimeType === 'application/vnd.google-apps.folder' ? '[Folder]' : '[File]';
       resultText += `- ${type} ${file.name} (ID: ${file.id})\n`;
      });
     }

     if (nextPageToken) {
      resultText += `\n(More files available. Use pageToken: ${nextPageToken} to fetch next page)`;
     }

     return { content: [{ type: 'text', text: resultText }] };

  } catch (error) {
   console.error('Error in list_files tool:', error);
   let message = 'An unknown error occurred';
   if (error instanceof z.ZodError) {
    // Handle Zod validation errors specifically
    message = `Invalid arguments for list_files: ${error.errors.map(e => e.message).join(', ')}`;
    throw new McpError(ErrorCode.InvalidParams, message);
   } else if (error instanceof Error) {
    // Handle standard Error objects
    // Check for Google API error structure (this is a common pattern, might need adjustment)
    const gapiError = error as any; // Use 'any' carefully for property checking
    message = gapiError.response?.data?.error?.message || gapiError.message;
   } else if (typeof error === 'string') {
    // Handle plain string errors
    message = error;
   }
   // Throw a generic internal error for all other cases
   throw new McpError(ErrorCode.InternalError, `Failed to list files: ${message}`);
  }
    // No break needed as return/throw exits

   case 'read_file':
    try {
     // 1. Validate arguments
     const validatedArgs = ReadFileArgsSchema.parse(args);
     const fileId = validatedArgs.fileId;
     console.error(`Reading file with ID: ${fileId}`);

     // 2. Call Google Drive API to get file content
     // Use alt: 'media' to download file content directly
     const response = await drive.files.get(
      {
       fileId: fileId,
       alt: 'media',
      },
      { responseType: 'text' } // Ensure response is treated as text
     );

     // 3. Format response
     // The response.data should directly contain the file content as a string
     const fileContent = response.data as string; // Cast because responseType is 'text'

     return { content: [{ type: 'text', text: fileContent }] };

  } catch (error) {
   console.error('Error in read_file tool:', error);
   let message = 'An unknown error occurred';
   let errorCode = ErrorCode.InternalError; // Default to internal error

   if (error instanceof z.ZodError) {
    message = `Invalid arguments for read_file: ${error.errors.map(e => e.message).join(', ')}`;
    errorCode = ErrorCode.InvalidParams;
   } else if (error instanceof Error) {
    const gapiError = error as any;
    message = gapiError.response?.data?.error?.message || gapiError.message;
    // Check specifically for Google API's 404 error code
    if (gapiError.code === 404 || gapiError.response?.status === 404) {
    	// Use InvalidRequest for client errors like not found, as per MCP spec suggestions
    	errorCode = ErrorCode.InvalidRequest;
    	message = `File not found (ID: ${args?.fileId}). ${message}`;
    }
   } else if (typeof error === 'string') {
    message = error;
   }

   throw new McpError(errorCode, `Failed to read file: ${message}`);
  }
    // No break needed

   case 'write_file':
    try {
     // 1. Validate arguments
     const validatedArgs = WriteFileArgsSchema.parse(args);
     const { fileName, content, parentFolderId, mimeType } = validatedArgs;
     console.error(`Writing file: ${fileName} to folder: ${parentFolderId} with mimeType: ${mimeType}`);

     // 2. Prepare request body and media for Google Drive API
     const fileMetadata = {
      name: fileName,
      parents: parentFolderId ? [parentFolderId] : [], // API expects an array of parent IDs
     };
     const media = {
      mimeType: mimeType,
      body: content, // The actual file content
     };

     // 3. Call Google Drive API to create the file
     const response = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, name', // Request the ID and name of the created file
     });

     // 4. Format success response
     const createdFile = response.data;
     const resultText = `Successfully created file '${createdFile.name}' (ID: ${createdFile.id}) in folder '${parentFolderId}'.`;
     return { content: [{ type: 'text', text: resultText }] };

  } catch (error) {
   console.error('Error in write_file tool:', error);
   let message = 'An unknown error occurred';
   if (error instanceof z.ZodError) {
    message = `Invalid arguments for write_file: ${error.errors.map(e => e.message).join(', ')}`;
    throw new McpError(ErrorCode.InvalidParams, message);
   } else if (error instanceof Error) {
    const gapiError = error as any;
    message = gapiError.response?.data?.error?.message || gapiError.message;
   } else if (typeof error === 'string') {
    message = error;
   }
   throw new McpError(ErrorCode.InternalError, `Failed to write file: ${message}`);
  }
    // No break needed

   case 'add_code_cell':
     try {
     // 1. Validate arguments
     const validatedArgs = AddCodeCellArgsSchema.parse(args);
     const { notebookFileId, code, position } = validatedArgs;
     console.error(`Adding code cell to notebook ID: ${notebookFileId} at position: ${position ?? 'end'}`);

     // 2. Download existing notebook content
     console.error(`Downloading notebook: ${notebookFileId}`);
     const downloadResponse = await drive.files.get(
      {
       fileId: notebookFileId,
       alt: 'media',
      },
      { responseType: 'text' } // Get content as text
     );
     const notebookContent = downloadResponse.data as string;

     // 3. Parse notebook JSON
     let notebookJson;
     try {
      notebookJson = JSON.parse(notebookContent);
     } catch (parseError) {
      console.error('Failed to parse notebook JSON:', parseError);
      throw new McpError(ErrorCode.InternalError, 'Failed to parse notebook content. Is it a valid .ipynb file?');
     }

     // Basic validation of notebook structure
     if (!notebookJson || !Array.isArray(notebookJson.cells)) {
      throw new McpError(ErrorCode.InternalError, 'Invalid notebook structure: "cells" array not found.');
     }

     // 4. Create the new code cell object
     // Reference: https://nbformat.readthedocs.io/en/latest/format_description.html#code-cells
     const newCell = {
      cell_type: 'code',
      execution_count: null, // No execution count initially
      metadata: {}, // Empty metadata
      outputs: [], // Empty outputs array
      source: code.split('\n').map(line => line + '\n'), // Split code into lines, add newline back as required by format
     };
        			// Remove trailing newline from the last line if present and unnecessary
        			if (newCell.source.length > 0 && newCell.source[newCell.source.length - 1] === '\n') {
        					newCell.source.pop();
        			}
        			 if (newCell.source.length > 0) {
        					 const lastLineIndex = newCell.source.length - 1;
        					 newCell.source[lastLineIndex] = newCell.source[lastLineIndex].replace(/\n$/, '');
        			 }


     // 5. Insert or append the new cell
     if (position !== undefined && position >= 0 && position <= notebookJson.cells.length) {
      notebookJson.cells.splice(position, 0, newCell);
      console.error(`Inserted new cell at position ${position}`);
     } else {
      notebookJson.cells.push(newCell);
      console.error('Appended new cell to the end');
     }

     // 6. Stringify the modified notebook content
     const updatedNotebookContent = JSON.stringify(notebookJson, null, 2); // Pretty print JSON

     // 7. Upload the modified content back to Google Drive
     console.error(`Uploading modified notebook: ${notebookFileId}`);
     const uploadResponse = await drive.files.update({
      fileId: notebookFileId,
      media: {
       mimeType: 'application/x-ipynb+json', // Ensure correct MIME type for notebooks
       body: updatedNotebookContent,
      },
      fields: 'id, name', // Request fields of the updated file
     });

     // 8. Format success response
     const updatedFile = uploadResponse.data;
     const resultText = `Successfully added code cell to notebook '${updatedFile.name}' (ID: ${updatedFile.id}).`;
     return { content: [{ type: 'text', text: resultText }] };

  } catch (error) {
   console.error('Error in add_code_cell tool:', error);
   let message = 'An unknown error occurred';
   let errorCode = ErrorCode.InternalError; // Default to internal error

   if (error instanceof z.ZodError) {
    message = `Invalid arguments for add_code_cell: ${error.errors.map(e => e.message).join(', ')}`;
    errorCode = ErrorCode.InvalidParams;
   } else if (error instanceof Error) {
    const gapiError = error as any;
    message = gapiError.response?.data?.error?.message || gapiError.message;
    // Check specifically for Google API's 404 error code
    if (gapiError.code === 404 || gapiError.response?.status === 404) {
     errorCode = ErrorCode.InvalidRequest; // Use InvalidRequest for client errors like not found
     message = `Notebook file not found (ID: ${args?.notebookFileId}). ${message}`;
    }
   } else if (typeof error === 'string') {
    message = error;
   }

   throw new McpError(errorCode, `Failed to add code cell: ${message}`);
  }
   // No break needed
			case 'edit_code_cell':
				try {
					// 1. Validate arguments
					const validatedArgs = EditCodeCellArgsSchema.parse(args);
					const { notebookFileId, cellIndex, newCode } = validatedArgs;
					console.error(`Editing cell index ${cellIndex} in notebook ID: ${notebookFileId}`);

					// 2. Download existing notebook content
					console.error(`Downloading notebook: ${notebookFileId}`);
					const downloadResponse = await drive.files.get(
						{
							fileId: notebookFileId,
							alt: 'media',
						},
						{ responseType: 'text' }
					);
					const notebookContent = downloadResponse.data as string;

					// 3. Parse notebook JSON
					let notebookJson;
					try {
						notebookJson = JSON.parse(notebookContent);
					} catch (parseError) {
						console.error('Failed to parse notebook JSON:', parseError);
						throw new McpError(ErrorCode.InternalError, 'Failed to parse notebook content. Is it a valid .ipynb file?');
					}

					// 4. Validate cell index and type
					if (!notebookJson || !Array.isArray(notebookJson.cells)) {
						throw new McpError(ErrorCode.InternalError, 'Invalid notebook structure: "cells" array not found.');
					}
					if (cellIndex < 0 || cellIndex >= notebookJson.cells.length) {
						throw new McpError(ErrorCode.InvalidParams, `Invalid cell index: ${cellIndex}. Notebook has ${notebookJson.cells.length} cells.`);
					}
					const targetCell = notebookJson.cells[cellIndex];
					if (targetCell.cell_type !== 'code') {
						throw new McpError(ErrorCode.InvalidParams, `Cell at index ${cellIndex} is not a code cell (type: ${targetCell.cell_type}).`);
					}

					// 5. Update the cell source
					targetCell.source = newCode.split('\n').map(line => line + '\n');
					// Clean up trailing newlines similar to add_code_cell
					if (targetCell.source.length > 0 && targetCell.source[targetCell.source.length - 1] === '\n') {
						targetCell.source.pop();
					}
					if (targetCell.source.length > 0) {
						const lastLineIndex = targetCell.source.length - 1;
						targetCell.source[lastLineIndex] = targetCell.source[lastLineIndex].replace(/\n$/, '');
					}
					console.error(`Updated source for cell index ${cellIndex}`);

					// 6. Stringify the modified notebook content
					const updatedNotebookContent = JSON.stringify(notebookJson, null, 2);

					// 7. Upload the modified content back to Google Drive
					console.error(`Uploading modified notebook: ${notebookFileId}`);
					const uploadResponse = await drive.files.update({
						fileId: notebookFileId,
						media: {
							mimeType: 'application/x-ipynb+json',
							body: updatedNotebookContent,
						},
						fields: 'id, name',
					});

					// 8. Format success response
					const updatedFile = uploadResponse.data;
					const resultText = `Successfully edited cell ${cellIndex} in notebook '${updatedFile.name}' (ID: ${updatedFile.id}).`;
					return { content: [{ type: 'text', text: resultText }] };

				} catch (error) {
					console.error('Error in edit_code_cell tool:', error);
					let message = 'An unknown error occurred';
					let errorCode = ErrorCode.InternalError;

					if (error instanceof z.ZodError) {
						message = `Invalid arguments for edit_code_cell: ${error.errors.map(e => e.message).join(', ')}`;
						errorCode = ErrorCode.InvalidParams;
					} else if (error instanceof Error) {
						const gapiError = error as any;
						message = gapiError.response?.data?.error?.message || gapiError.message;
						if (gapiError.code === 404 || gapiError.response?.status === 404) {
							errorCode = ErrorCode.InvalidRequest;
							message = `Notebook file not found (ID: ${args?.notebookFileId}). ${message}`;
						}
					} else if (typeof error === 'string') {
						message = error;
					}

					throw new McpError(errorCode, `Failed to edit code cell: ${message}`);
				}
				// No break needed

   default:
    throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
  }
  // Note: Removed the explicit 'return;' here as all paths should return or throw.
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Google Colab MCP server running on stdio (pending auth setup)');
    }
}

// --- Initialize and run the server ---
async function startServer() {
	try {
		console.error('Starting server initialization...');
		console.error('Environment variables:', {
			CLIENT_ID: process.env.GOOGLE_CLIENT_ID ? 'Set' : 'Not set',
			CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ? 'Set' : 'Not set',
			REFRESH_TOKEN: process.env.GOOGLE_REFRESH_TOKEN ? 'Set' : 'Not set'
		});
		initializeGoogleAuth(); // Initialize auth synchronously on startup
		console.error('Google auth initialized successfully');
		const server = new GoogleColabMcpServer();
		console.error('Server instance created, about to run...');
		await server.run(); // Keep server running
	} catch (error) {
		console.error('Failed to start Google Colab MCP Server:', error);
		process.exit(1); // Exit if initialization fails
	}
}

startServer();