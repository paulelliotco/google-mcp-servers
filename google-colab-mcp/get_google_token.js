// get_google_token.js
// This script helps obtain a Google API Refresh Token for offline access.
// Run this script using Node.js: node get_google_token.js

import 'dotenv/config'; // Load environment variables from .env file
import { google } from 'googleapis';
import readline from 'readline/promises'; // Use promises interface for readline
import process from 'process'; // Import process for stdin/stdout

// --- Configuration (Loaded from .env file) ---
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // Out-of-band (OOB) for desktop apps

// Scopes required for Google Drive access (adjust if needed)
// https://developers.google.com/identity/protocols/oauth2/scopes#drive
const SCOPES = ['https://www.googleapis.com/auth/drive'];

// --- Script Logic ---

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  // Check if credentials were loaded from .env
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('\nERROR: Please ensure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set in the .env file.\n');
    rl.close();
    process.exit(1);
  }

  const oAuth2Client = new google.auth.OAuth2(
    CLIENT_ID,
    CLIENT_SECRET,
    REDIRECT_URI
  );

  // Generate the url that will be used for the consent dialog.
  const authorizeUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline', // Request a refresh token
    scope: SCOPES,
    prompt: 'consent', // Force consent screen even if previously authorized
  });

  console.log('\n--- Google Refresh Token Generation ---');
  console.log('\nPlease authorize this application by visiting the following URL in your browser:');
  console.log(`\n${authorizeUrl}\n`);

  // Prompt the user to enter the authorization code
  const code = await rl.question('After authorizing, paste the authorization code here: ');
  rl.close(); // Close the readline interface

  if (!code) {
    console.error('Authorization code is required.');
    process.exit(1);
  }

  try {
    // Exchange the authorization code for tokens
    console.log('\nExchanging authorization code for tokens...');
    const { tokens } = await oAuth2Client.getToken(code.trim());
    oAuth2Client.setCredentials(tokens);

    console.log('\nTokens obtained successfully!');

    if (tokens.refresh_token) {
      console.log('\n---------------------------------------------------------------------');
      console.log('IMPORTANT: Copy and securely store your REFRESH TOKEN below.');
      console.log('You will need to provide this to configure the MCP server.');
      console.log('\nREFRESH TOKEN:');
      console.log(tokens.refresh_token);
      console.log('---------------------------------------------------------------------\n');
    } else {
      console.warn('\nWARNING: A refresh token was not returned. This might happen if:');
      console.warn('  - You have previously authorized this client ID without requesting offline access.');
      console.warn('  - The OAuth consent screen is not fully configured or published.');
      console.warn('  - Try revoking access for the app in your Google Account settings and run the script again.');
      console.warn('\nAccess Token (expires soon):', tokens.access_token);
    }
  } catch (err) {
    console.error('\nError retrieving access token:', err.message || err);
    if (err.response?.data) {
        console.error('API Error Details:', err.response.data);
    }
    process.exit(1);
  }
}

main().catch(console.error);