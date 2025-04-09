# Google Colab MCP Server

This MCP server allows interaction with Google Drive files, specifically targeting Google Colaboratory notebooks (`.ipynb`). It enables listing files, reading files, writing files, adding new code cells, and editing existing code cells within notebooks stored on Google Drive.

**Note:** This server interacts with the *files* on Google Drive. It does not directly execute code within a *live* Colab session.

## Features

*   **`list_files`**: List files/folders in a Google Drive folder (defaults to root).
*   **`read_file`**: Read the content of a file from Google Drive by its ID.
*   **`write_file`**: Create or overwrite a file on Google Drive.
*   **`add_code_cell`**: Add a new code cell to an existing `.ipynb` file on Google Drive.
*   **`edit_code_cell`**: Edit the source code of an existing code cell within an `.ipynb` file on Google Drive.

## Setup Instructions

1.  **Clone the Repository:**
    ```bash
    git clone https://github.com/paulelliotco/google-mcp-servers.git
    cd google-mcp-servers/google-colab-mcp
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Obtain Google Cloud Credentials:**
    *   Go to the [Google Cloud Console](https://console.cloud.google.com/).
    *   Create or select a project.
    *   Enable the **Google Drive API**.
    *   Configure the **OAuth consent screen**:
        *   Choose **External** user type.
        *   Provide an App name (e.g., "Colab MCP Tool"), User support email, and Developer contact information.
        *   Save through Scopes and Test users.
        *   **Important:** Under "Test users", click "+ ADD USERS" and add the Google account email address you will use to authorize access to Drive.
        *   Publish the app if prompted (status should be "Testing" or "Production").
    *   Go to **Credentials** > **+ CREATE CREDENTIALS** > **OAuth client ID**.
    *   Select **Application type:** **Desktop app**.
    *   Give it a name (e.g., "Colab MCP Desktop Client").
    *   Click **Create**.
    *   Copy the **Client ID** and **Client Secret**.

4.  **Generate Refresh Token:**
    *   Create a `.env` file in the `google-colab-mcp` directory with the following content, replacing the placeholders with your credentials:
        ```dotenv
        # Google Cloud Credentials for get_google_token.js script
        GOOGLE_CLIENT_ID=YOUR_CLIENT_ID_HERE
        GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET_HERE
        ```
    *   Run the helper script:
        ```bash
        node get_google_token.js
        ```
    *   Follow the printed URL in your browser, log in with the Google account you added as a test user, and grant permissions.
    *   Copy the authorization code provided by Google back into the terminal when prompted.
    *   The script will output your **Refresh Token**. Copy this token securely.

5.  **Configure MCP Client (Cursor or Claude):**
    *   Add the following configuration block to your MCP client's settings file (e.g., `mcp_settings.json` for Cursor, `claude_desktop_config.json` for Claude). Replace placeholders with your actual credentials and ensure the `args` path points to the correct location of `build/index.js` on your system.

    **Example Configuration:**
    ```json
    {
      "mcpServers": {
        // ... other servers might be here ...
        "google-colab": {
          "command": "node",
          "args": [
            // --- IMPORTANT: Update this path if needed ---
            "d:/Cascade Projects/Assignment/google-mcp-servers/google-colab-mcp/build/index.js"
          ],
          "env": {
            "GOOGLE_CLIENT_ID": "YOUR_CLIENT_ID_FROM_STEP_3",
            "GOOGLE_CLIENT_SECRET": "YOUR_CLIENT_SECRET_FROM_STEP_3",
            "GOOGLE_REFRESH_TOKEN": "YOUR_REFRESH_TOKEN_FROM_STEP_4"
          },
          "disabled": false,
          "alwaysAllow": [] // Add specific tool names here if desired
        }
        // ... other servers might be here ...
      }
    }
    ```
    *   **Cursor Path (Example):** `C:\Users\<YourUsername>\AppData\Roaming\Cursor\User\globalStorage\rooveterinaryinc.roo-cline\settings\mcp_settings.json`
    *   **Claude Path (Example - Confirm for your OS):** `C:\Users\<YourUsername>\AppData\Roaming\Claude\claude_desktop_config.json`

6.  **Build the Server:**
    ```bash
    npm run build
    ```

7.  **Restart MCP Client:** Restart Cursor or Claude for the settings changes to take effect. The `google-colab` server should now connect and its tools become available.

## Usage

You can now use the tools via your MCP client (e.g., Roo):

*   `@google-colab list_files` (Lists root folder)
*   `@google-colab list_files folderId:"FOLDER_ID"`
*   `@google-colab read_file fileId:"FILE_ID"`
*   `@google-colab write_file fileName:"new_file.txt" content:"Hello World"`
*   `@google-colab add_code_cell notebookFileId:"NOTEBOOK_ID" code:"print('New cell')"`
*   `@google-colab edit_code_cell notebookFileId:"NOTEBOOK_ID" cellIndex:0 newCode:"print('Edited cell')"`