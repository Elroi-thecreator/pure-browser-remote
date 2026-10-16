const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Rooms status endpoint (metadata only, no sensitive tokens)
app.get('/api/status', (req, res) => {
  const activeRooms = [];
  rooms.forEach((room, pin) => {
    activeRooms.push({
      pin,
      hasHost: !!room.hostWs && room.hostWs.readyState === WebSocket.OPEN,
      hasViewer: !!room.viewerWs && room.viewerWs.readyState === WebSocket.OPEN,
      createdAt: room.createdAt
    });
  });
  res.json({
    totalRooms: rooms.size,
    rooms: activeRooms
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

// In-memory Room State: Map<pin, { pin, hostWs, viewerWs, createdAt } >
const rooms = new Map();

function sendJson(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function cleanupClient(ws) {
  if (!ws.roomPin) return;
  const pin = ws.roomPin;
  const room = rooms.get(pin);
  if (!room) return;

  if (ws.clientRole === 'host') {
    console.log(`[Signaling] Host left room PIN: ${pin}`);
    if (room.viewerWs && room.viewerWs.readyState === WebSocket.OPEN) {
      sendJson(room.viewerWs, {
        type: 'host-disconnected',
        message: 'Host has closed the session or lost connection.'
      });
      room.viewerWs.roomPin = null;
    }
    rooms.delete(pin);
  } else if (ws.clientRole === 'viewer') {
    console.log(`[Signaling] Viewer left room PIN: ${pin}`);
    if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
      sendJson(room.hostWs, {
        type: 'viewer-disconnected',
        message: 'Viewer disconnected.'
      });
    }
    room.viewerWs = null;
  }
}

wss.on('connection', (ws, req) => {
  const remoteIp = req.socket.remoteAddress;
  console.log(`[Signaling] Client connected from ${remoteIp}`);

  ws.isAlive = true;
  ws.roomPin = null;
  ws.clientRole = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (rawMessage) => {
    let msg;
    try {
      msg = JSON.parse(rawMessage);
    } catch (err) {
      console.error('[Signaling] Failed to parse message JSON:', err.message);
      sendJson(ws, { type: 'error', message: 'Malformed JSON payload.' });
      return;
    }

    const { type, pin, role, data } = msg;

    switch (type) {
      case 'ping':
        sendJson(ws, { type: 'pong', timestamp: Date.now() });
        break;

      case 'register-host': {
        if (!pin || typeof pin !== 'string') {
          sendJson(ws, { type: 'error', message: 'Valid PIN required to register host.' });
          return;
        }

        const normalizedPin = pin.trim();
        const existing = rooms.get(normalizedPin);

        if (existing && existing.hostWs && existing.hostWs !== ws && existing.hostWs.readyState === WebSocket.OPEN) {
          sendJson(ws, {
            type: 'error',
            message: `Room PIN ${normalizedPin} is already actively hosted by another session.`
          });
          return;
        }

        ws.roomPin = normalizedPin;
        ws.clientRole = 'host';

        const roomObj = existing || {
          pin: normalizedPin,
          hostWs: ws,
          viewerWs: null,
          createdAt: new Date().toISOString()
        };
        roomObj.hostWs = ws;
        rooms.set(normalizedPin, roomObj);

        console.log(`[Signaling] Host registered room PIN: ${normalizedPin}`);
        sendJson(ws, {
          type: 'host-registered',
          pin: normalizedPin,
          message: 'Host successfully registered. Awaiting viewer connection.'
        });

        // If a viewer was already connected/waiting in this room
        if (roomObj.viewerWs && roomObj.viewerWs.readyState === WebSocket.OPEN) {
          sendJson(roomObj.viewerWs, { type: 'host-ready', pin: normalizedPin });
          sendJson(ws, { type: 'viewer-joined', pin: normalizedPin });
        }
        break;
      }

      case 'join-viewer': {
        if (!pin || typeof pin !== 'string') {
          sendJson(ws, { type: 'error', message: 'Valid PIN required to join room.' });
          return;
        }

        const normalizedPin = pin.trim();
        const room = rooms.get(normalizedPin);

        if (!room || !room.hostWs || room.hostWs.readyState !== WebSocket.OPEN) {
          console.warn(`[Signaling] Viewer attempt for non-existent or inactive PIN: ${normalizedPin}`);
          sendJson(ws, {
            type: 'error',
            code: 'ROOM_NOT_FOUND',
            message: `No active host found for room PIN: ${normalizedPin}. Verify the PIN on the host display.`
          });
          return;
        }

        ws.roomPin = normalizedPin;
        ws.clientRole = 'viewer';
        room.viewerWs = ws;

        console.log(`[Signaling] Viewer joined room PIN: ${normalizedPin}`);

        sendJson(ws, {
          type: 'viewer-accepted',
          pin: normalizedPin,
          message: 'Connected to room. Initiating WebRTC handshake.'
        });

        // Notify host that viewer joined, triggering WebRTC Offer generation
        sendJson(room.hostWs, {
          type: 'viewer-joined',
          pin: normalizedPin
        });
        break;
      }

      case 'signal': {
        const roomPin = ws.roomPin || pin;
        if (!roomPin) {
          sendJson(ws, { type: 'error', message: 'No active room assigned for signal relay.' });
          return;
        }

        const room = rooms.get(roomPin);
        if (!room) {
          sendJson(ws, { type: 'error', message: 'Target room does not exist.' });
          return;
        }

        if (ws.clientRole === 'host') {
          if (room.viewerWs && room.viewerWs.readyState === WebSocket.OPEN) {
            sendJson(room.viewerWs, {
              type: 'signal',
              from: 'host',
              data: data
            });
          }
        } else if (ws.clientRole === 'viewer') {
          if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
            sendJson(room.hostWs, {
              type: 'signal',
              from: 'viewer',
              data: data
            });
          }
        }
        break;
      }

      case 'leave':
        cleanupClient(ws);
        break;

      default:
        console.warn(`[Signaling] Unrecognized message type: ${type}`);
        sendJson(ws, { type: 'warning', message: `Unknown message type: ${type}` });
        break;
    }
  });

  ws.on('close', () => {
    cleanupClient(ws);
  });

  ws.on('error', (err) => {
    console.error('[Signaling] WebSocket error:', err.message);
    cleanupClient(ws);
  });
});

// Periodic heartbeat to prevent dead connections (every 25 seconds)
const heartbeatInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      console.log(`[Signaling] Terminating inactive client in room ${ws.roomPin || 'none'}`);
      cleanupClient(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Chrome OS Remote Desktop - Signaling & Viewer Server  `);
  console.log(`=======================================================`);
  console.log(` HTTP & Web App URL : http://localhost:${PORT}`);
  console.log(` WebSocket Endpoint : ws://localhost:${PORT}/ws`);
  console.log(` Ready for Host & Viewer WebRTC connections.`);
  console.log(`=======================================================`);
});
