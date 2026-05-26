const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const { randomUUID } = require('crypto');

const app = express();
const requireAuth = Boolean(process.env.RELAY_AUTH_TOKEN);
const useHttps = process.env.USE_HTTPS === '1' || process.env.HTTPS === 'true';

let server;
if (useHttps) {
  const certPath = process.env.HTTPS_CERT_PATH || path.join(__dirname, 'certs', 'server.crt');
  const keyPath = process.env.HTTPS_KEY_PATH || path.join(__dirname, 'certs', 'server.key');

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    console.error('HTTPS is enabled but certificate files were not found:');
    console.error(`  cert: ${certPath}`);
    console.error(`  key: ${keyPath}`);
    process.exit(1);
  }

  server = https.createServer({
    cert: fs.readFileSync(certPath),
    key: fs.readFileSync(keyPath)
  }, app);
  console.log('Starting HTTPS relay server');
} else {
  server = http.createServer(app);
}

const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Map(),
      idleTimer: null
    });
  }
  return rooms.get(roomId);
}

function clearRoomIdleTimeout(room) {
  if (room?.idleTimer) {
    clearTimeout(room.idleTimer);
    room.idleTimer = null;
  }
}

function scheduleRoomClose(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  clearRoomIdleTimeout(room);
  room.idleTimer = setTimeout(() => closeRoom(roomId), 10 * 60 * 1000);
}

function closeRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;

  for (const [clientId, client] of room.clients.entries()) {
    sendWs(client.ws, {
      type: 'room-closed',
      message: 'Room closed due to inactivity. Chat session ended for security.'
    });
    client.ws.close();
  }

  clearRoomIdleTimeout(room);
  rooms.delete(roomId);
  console.log(`Room ${roomId} closed after 10 minutes of inactivity.`);
}

function sendWs(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(roomId, message, exceptId) {
  const room = rooms.get(roomId);
  if (!room) return;
  for (const [clientId, client] of room.clients.entries()) {
    if (clientId !== exceptId && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }
}

wss.on('connection', (ws) => {
  ws.id = randomUUID();
  ws.roomId = null;
  ws.username = null;
  ws.publicKey = null;

  ws.on('message', (message) => {
    try {
      const payload = JSON.parse(message);

      if (payload.type === 'join') {
        const { roomId, username, publicKey, authToken } = payload;
        if (!roomId || !publicKey) {
          sendWs(ws, { type: 'error', message: 'roomId and publicKey are required to join.' });
          return;
        }
        if (requireAuth && (!authToken || authToken !== process.env.RELAY_AUTH_TOKEN)) {
          sendWs(ws, { type: 'error', message: 'Invalid or missing relay auth token.' });
          return;
        }

        ws.roomId = roomId;
        ws.username = username || 'Anonymous';
        ws.publicKey = publicKey;

        const room = getRoom(roomId);
        room.clients.set(ws.id, {
          ws,
          username: ws.username,
          publicKey: ws.publicKey
        });
        scheduleRoomClose(roomId);

        const peers = Array.from(room.clients.entries())
          .filter(([peerId]) => peerId !== ws.id)
          .map(([peerId, peer]) => ({
            clientId: peerId,
            username: peer.username,
            publicKey: peer.publicKey
          }));

        sendWs(ws, {
          type: 'joined',
          clientId: ws.id,
          roomId,
          peers
        });

        broadcast(roomId, {
          type: 'peer-joined',
          clientId: ws.id,
          username: ws.username,
          publicKey: ws.publicKey
        }, ws.id);
      }

      if (payload.type === 'leave' && ws.roomId) {
        const room = rooms.get(ws.roomId);
        if (room) {
          room.clients.delete(ws.id);
          broadcast(ws.roomId, {
            type: 'peer-left',
            clientId: ws.id,
            username: ws.username
          });
          if (room.clients.size === 0) {
            clearRoomIdleTimeout(room);
            rooms.delete(ws.roomId);
          }
        }
        ws.close();
      }

      if (payload.type === 'message' && ws.roomId) {
        const room = rooms.get(ws.roomId);
        if (room) {
          scheduleRoomClose(ws.roomId);
        }
        broadcast(ws.roomId, {
          type: 'message',
          senderId: ws.id,
          senderName: ws.username,
          timestamp: Date.now(),
          payloads: payload.payloads
        }, ws.id);
      }
    } catch (err) {
      console.error('Invalid message received:', err);
      sendWs(ws, { type: 'error', message: 'Invalid message format.' });
    }
  });

  ws.on('close', () => {
    if (ws.roomId) {
      const room = rooms.get(ws.roomId);
      if (room) {
        room.clients.delete(ws.id);
        broadcast(ws.roomId, {
          type: 'peer-left',
          clientId: ws.id,
          username: ws.username
        });
        if (room.clients.size === 0) {
          clearRoomIdleTimeout(room);
          rooms.delete(ws.roomId);
        }
      }
    }
  });
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`Encrypted chat room server running on http://localhost:${port}`);
});
