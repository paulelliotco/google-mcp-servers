#!/usr/bin/env node
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Determine the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env file from the project root (one level up from src/ or build/)
dotenv.config({ path: path.resolve(__dirname, '../.env') });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
    CallToolRequestSchema,
    ErrorCode,
    ListToolsRequestSchema,
    McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { Client, GeocodeRequest, ReverseGeocodeRequest, DirectionsRequest, DistanceMatrixRequest } from "@googlemaps/google-maps-services-js";

const API_KEY = process.env.GOOGLE_MAPS_API_KEY; // Will be provided by MCP config
if (!API_KEY) {
    throw new Error('GOOGLE_MAPS_API_KEY environment variable is required');
}

// --- Type Guards for Tool Arguments ---

const isGeocodeArgs = (args: any): args is { address: string } =>
    typeof args === 'object' && args !== null && typeof args.address === 'string';

const isReverseGeocodeArgs = (args: any): args is { lat: number; lng: number } =>
    typeof args === 'object' && args !== null && typeof args.lat === 'number' && typeof args.lng === 'number';

const isDirectionsArgs = (args: any): args is { origin: string; destination: string; mode?: string } =>
    typeof args === 'object' &&
    args !== null &&
    typeof args.origin === 'string' &&
    typeof args.destination === 'string' &&
    (args.mode === undefined || typeof args.mode === 'string');

const isDistanceMatrixArgs = (args: any): args is { origins: string[]; destinations: string[]; mode?: string } =>
    typeof args === 'object' &&
    args !== null &&
    Array.isArray(args.origins) && args.origins.every((o: any) => typeof o === 'string') && // Add explicit any type
    Array.isArray(args.destinations) && args.destinations.every((d: any) => typeof d === 'string') && // Add explicit any type
    (args.mode === undefined || typeof args.mode === 'string');


class GoogleMapsServer {
    private server: Server;
    private googleMapsClient: Client;

    constructor() {
        this.server = new Server(
            {
                name: 'google-maps-server',
                version: '0.1.0',
            },
            {
                capabilities: {
                    // Resources not implemented for this example, focusing on tools
                    resources: {},
                    tools: {},
                },
            }
        );

        this.googleMapsClient = new Client({}); // API key is passed per request

        this.setupToolHandlers();

        // Error handling
        this.server.onerror = (error) => console.error('[MCP Error]', error);
        process.on('SIGINT', async () => {
            await this.server.close();
            process.exit(0);
        });
    }

    private setupToolHandlers() {
        this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: 'geocode',
                    description: 'Convert an address into geographic coordinates (latitude/longitude).',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            address: { type: 'string', description: 'The street address to geocode.' },
                        },
                        required: ['address'],
                    },
                },
                {
                    name: 'reverse_geocode',
                    description: 'Convert geographic coordinates (latitude/longitude) into a human-readable address.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            lat: { type: 'number', description: 'The latitude.' },
                            lng: { type: 'number', description: 'The longitude.' },
                        },
                        required: ['lat', 'lng'],
                    },
                },
                {
                    name: 'get_directions',
                    description: 'Get directions between two locations.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            origin: { type: 'string', description: 'The starting address or place ID.' },
                            destination: { type: 'string', description: 'The destination address or place ID.' },
                            mode: { type: 'string', description: 'Mode of transport (driving, walking, bicycling, transit). Default: driving', enum: ['driving', 'walking', 'bicycling', 'transit'] },
                        },
                        required: ['origin', 'destination'],
                    },
                },
                {
                    name: 'get_distance_matrix',
                    description: 'Calculate travel time and distance between multiple origins and destinations.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            origins: { type: 'array', items: { type: 'string' }, description: 'Array of starting addresses or place IDs.' },
                            destinations: { type: 'array', items: { type: 'string' }, description: 'Array of destination addresses or place IDs.' },
                            mode: { type: 'string', description: 'Mode of transport (driving, walking, bicycling, transit). Default: driving', enum: ['driving', 'walking', 'bicycling', 'transit'] },
                        },
                        required: ['origins', 'destinations'],
                    },
                },
            ],
        }));

        this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const toolName = request.params.name;
            const args = request.params.arguments;

            try {
                let response;
                switch (toolName) {
                    case 'geocode':
                        if (!isGeocodeArgs(args)) throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for geocode');
                        response = await this.googleMapsClient.geocode({ params: { address: args.address, key: API_KEY! } }); // Use non-null assertion
                        break;
                    case 'reverse_geocode':
                        if (!isReverseGeocodeArgs(args)) throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for reverse_geocode');
                        response = await this.googleMapsClient.reverseGeocode({ params: { latlng: { lat: args.lat, lng: args.lng }, key: API_KEY! } }); // Use non-null assertion
                        break;
                    case 'get_directions':
                        if (!isDirectionsArgs(args)) throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_directions');
                        const directionsParams: DirectionsRequest['params'] = {
                            origin: args.origin,
                            destination: args.destination,
                            mode: args.mode as any, // Cast needed as SDK type might be stricter
                            key: API_KEY! // Use non-null assertion
                        };
                        response = await this.googleMapsClient.directions({ params: directionsParams });
                        break;
                    case 'get_distance_matrix':
                        if (!isDistanceMatrixArgs(args)) throw new McpError(ErrorCode.InvalidParams, 'Invalid arguments for get_distance_matrix');
                         const matrixParams: DistanceMatrixRequest['params'] = {
                            origins: args.origins,
                            destinations: args.destinations,
                            mode: args.mode as any, // Cast needed
                            key: API_KEY! // Use non-null assertion
                        };
                        response = await this.googleMapsClient.distancematrix({ params: matrixParams });
                        break;
                    default:
                        throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${toolName}`);
                }

                return {
                    content: [{ type: 'text', text: JSON.stringify(response.data, null, 2) }],
                };

            } catch (error: any) {
                 console.error(`Error calling tool ${toolName}:`, error.response?.data || error.message || error);
                 const errorMessage = error.response?.data?.error_message || error.response?.data?.status || error.message || 'Unknown Google Maps API error';
                 return {
                     content: [{ type: 'text', text: `Google Maps API Error: ${errorMessage}` }],
                     isError: true,
                 };
            }
        });
    }

    async run() {
        const transport = new StdioServerTransport();
        await this.server.connect(transport);
        console.error('Google Maps MCP server running on stdio');
    }
}

const server = new GoogleMapsServer();
server.run().catch(console.error);
