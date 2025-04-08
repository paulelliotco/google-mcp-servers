# Google Maps MCP Server

A Model Context Protocol (MCP) server providing tools to interact with various Google Maps APIs.

This server allows clients (like AI assistants) to perform actions such as geocoding, reverse geocoding, getting directions, and calculating distance matrices using the Google Maps Platform.

## Features

### Tools

This server exposes the following tools:

-   **`geocode`**: Converts a street address into geographic coordinates (latitude/longitude).
    -   Input: `{ "address": "string" }`
    -   Example: Geocode "1600 Amphitheatre Parkway, Mountain View, CA"
-   **`reverse_geocode`**: Converts geographic coordinates into a human-readable address.
    -   Input: `{ "lat": number, "lng": number }`
    -   Example: Reverse geocode latitude 40.7128, longitude -74.0060
-   **`get_directions`**: Provides step-by-step directions between two locations.
    -   Input: `{ "origin": "string", "destination": "string", "mode"?: "driving" | "walking" | "bicycling" | "transit" }` (mode defaults to driving)
    -   Example: Get directions from "San Francisco, CA" to "Los Angeles, CA"
-   **`get_distance_matrix`**: Calculates travel time and distance for multiple origins and destinations.
    -   Input: `{ "origins": ["string"], "destinations": ["string"], "mode"?: "driving" | "walking" | "bicycling" | "transit" }` (mode defaults to driving)
    -   Example: Get distance matrix for origins ["New York, NY", "Washington, DC"] and destinations ["Boston, MA", "Philadelphia, PA"]

## Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/paulelliotco/google-mcp-servers.git
    cd google-mcp-servers/google-maps-mcp
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Create `.env` file:**
    Create a file named `.env` in the `google-maps-mcp` directory.

4.  **Add API Key:**
    Add your Google Maps API key to the `.env` file:
    ```dotenv
    GOOGLE_MAPS_API_KEY=YOUR_API_KEY_HERE
    ```
    *Note: Ensure you have enabled the necessary APIs (Geocoding, Directions, Distance Matrix, Places) in your Google Cloud project.*

5.  **Build the server:**
    ```bash
    npm run build
    ```

## Installation (for MCP Clients like Roo/Cursor)

Configure your MCP client to use this server. Add an entry to your `mcp_settings.json` (location varies by client):

```json
{
  "mcpServers": {
    "google-maps": {
      "command": "node",
      "args": ["/path/to/google-mcp-servers/google-maps-mcp/build/index.js"],
      "env": {}, // Key is loaded via .env by the server itself
      "disabled": false,
      "alwaysAllow": [] // Add tool names here if you want to skip confirmation
    }
  }
}
```
*Replace `/path/to/` with the actual absolute path to the cloned repository.*

## Development

-   **Build:** `npm run build` (Compiles TypeScript to JavaScript in `build/`)
-   **Watch:** `npm run watch` (Automatically rebuilds on file changes)
-   **Lint:** `npm run lint` (Checks code style)
