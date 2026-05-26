# Encrypted Chat Room

A secure end-to-end encrypted chat room using browser-based X25519 key exchange and a WebSocket relay server.

## Features

- Browser-based chat interface
- Room-based message relaying
- Browser-compatible ECDH key exchange for peer-to-peer session keys
- AES-GCM 256-bit encryption for every message
- Image sharing support with client-side encryption
- Logout clears chat history and keys from the browser
- Idle rooms close automatically after 10 minutes of no activity
- Server only relays encrypted payloads and never sees plaintext

## Run locally

1. Install dependencies:

   npm install

2. Start the server:

   npm start

3. Open `http://localhost:3000` in two browser windows or tabs.

4. Do not open `index.html` directly from the file system. The app must run through the local server.

5. Use the same room ID in both windows and choose different usernames.

## Production deployment

To enable HTTPS/TLS:

1. Generate or obtain SSL certificates (server.crt and server.key).

2. Place them in a `certs/` directory.

3. Set environment variables:
   - `USE_HTTPS=1`
   - `HTTPS_CERT_PATH=/path/to/server.crt`
   - `HTTPS_KEY_PATH=/path/to/server.key`

To enable relay authentication:

1. Set `RELAY_AUTH_TOKEN=your-secret-token`

2. Clients must provide the token in the auth field to join.

For fingerprint verification:

- Each user sees their own fingerprint and peers' fingerprints.
- Manually verify fingerprints out-of-band (e.g., over phone or in person).
- Click "Verify" after confirming the fingerprint matches.

## Security notes

- The server only relays encrypted payloads.
- Each participant exchanges X25519 public keys to derive unique shared keys.
- The server cannot decrypt messages because it never receives plaintext or shared secrets.
- Public key fingerprints are displayed for manual verification (compare out-of-band).
- Optional relay authentication token prevents unauthorized access.
- HTTPS/TLS support for production deployments.
- This is a strong E2EE example, but production deployments should still use TLS, identity verification, and hardened authentication.
