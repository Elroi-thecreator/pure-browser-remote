const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { WebSocketServer, WebSocket } = require('ws');


const PORT = process.env.PORT || 8080;
const app = express();

app.use(cors());
app.use(express.json());

// Resolve viewer path across various deployment environments & root directories
const candidateViewerPaths = [
  path.join(__dirname, '../viewer'),
  path.join(__dirname, 'viewer'),
  path.join(process.cwd(), 'pure-browser-remote/viewer'),
  path.join(process.cwd(), 'viewer')
];
const viewerPath = candidateViewerPaths.find(p => fs.existsSync(p)) || path.join(__dirname, '../viewer');

console.log(`[Signaling] Serving viewer client from: ${viewerPath}`);
app.use('/viewer', express.static(viewerPath));
app.use(express.static(viewerPath));

// Direct shortcut for zero-install web hosting
app.get('/host', (req, res) => {
  const hostWebPath = path.join(viewerPath, 'host_web.html');
  if (fs.existsSync(hostWebPath)) {
    res.sendFile(hostWebPath);
  } else {
    res.status(404).send('host_web.html not found');
  }
});




// Room state store: Map<pin, { pin, hostWs, viewerWs, createdAt }>
const rooms = new Map();

// Service status endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Pure Browser Remote - Cloud Signaling Relay',
    status: 'online',
    activeRooms: rooms.size,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', rooms: rooms.size });
});

const server = http.createServer(app);

// WebSocket Server attached to HTTP server (supports root and /ws)
const wss = new WebSocketServer({ server });

function sendJson(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function cleanupConnection(ws) {
  if (!ws.roomPin) return;
  const pin = ws.roomPin;
  const room = rooms.get(pin);
  if (!room) return;

  if (ws.clientRole === 'host') {
    console.log(`[Signaling] Host left room PIN: ${pin}`);
    if (room.viewerWs && room.viewerWs.readyState === WebSocket.OPEN) {
      sendJson(room.viewerWs, {
        type: 'host-disconnected',
        message: 'Host has closed the remote session.'
      });
      room.viewerWs.roomPin = null;
    }
    rooms.delete(pin);
  } else if (ws.clientRole === 'viewer') {
    console.log(`[Signaling] Viewer left room PIN: ${pin}`);
    if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
      sendJson(room.hostWs, {
        type: 'viewer-disconnected',
        message: 'Remote viewer has disconnected.'
      });
    }
    room.viewerWs = null;
  }
}

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[Signaling] New WebSocket connection from: ${ip}`);

  ws.isAlive = true;
  ws.roomPin = null;
  ws.clientRole = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (err) {
      sendJson(ws, { type: 'error', message: 'Invalid JSON payload.' });
      return;
    }

    const { type, pin, data } = msg;

    switch (type) {
      case 'ping':
        sendJson(ws, { type: 'pong', timestamp: Date.now() });
        break;

      case 'register-host': {
        if (!pin || typeof pin !== 'string') {
          sendJson(ws, { type: 'error', message: 'Room PIN required.' });
          return;
        }

        const cleanPin = pin.trim();
        const existing = rooms.get(cleanPin);

        if (existing && existing.hostWs && existing.hostWs !== ws && existing.hostWs.readyState === WebSocket.OPEN) {
          sendJson(ws, {
            type: 'error',
            message: `Room PIN ${cleanPin} is already actively being hosted.`
          });
          return;
        }

        ws.roomPin = cleanPin;
        ws.clientRole = 'host';

        const roomObj = existing || {
          pin: cleanPin,
          hostWs: ws,
          viewerWs: null,
          createdAt: new Date().toISOString()
        };
        roomObj.hostWs = ws;
        rooms.set(cleanPin, roomObj);

        console.log(`[Signaling] Host registered PIN: ${cleanPin}`);
        sendJson(ws, {
          type: 'host-registered',
          pin: cleanPin,
          message: 'Host successfully registered. Awaiting viewer...'
        });

        // Notify if a viewer is already waiting in this room
        if (roomObj.viewerWs && roomObj.viewerWs.readyState === WebSocket.OPEN) {
          sendJson(roomObj.viewerWs, { type: 'host-ready', pin: cleanPin });
          sendJson(ws, { type: 'viewer-joined', pin: cleanPin });
        }
        break;
      }

      case 'join-viewer': {
        if (!pin || typeof pin !== 'string') {
          sendJson(ws, { type: 'error', message: 'Room PIN required.' });
          return;
        }

        const cleanPin = pin.trim();
        const room = rooms.get(cleanPin);

        if (!room || !room.hostWs || room.hostWs.readyState !== WebSocket.OPEN) {
          sendJson(ws, {
            type: 'error',
            message: `No active host found for room PIN: ${cleanPin}. Verify the PIN displayed on the host screen.`
          });
          return;
        }

        ws.roomPin = cleanPin;
        ws.clientRole = 'viewer';
        room.viewerWs = ws;

        console.log(`[Signaling] Viewer joined room PIN: ${cleanPin}`);
        sendJson(ws, {
          type: 'viewer-accepted',
          pin: cleanPin,
          message: 'Connected to room. Starting WebRTC handshake...'
        });

        // Signal host to generate WebRTC offer
        sendJson(room.hostWs, {
          type: 'viewer-joined',
          pin: cleanPin
        });
        break;
      }

      case 'signal': {
        const roomPin = ws.roomPin || pin;
        if (!roomPin) {
          sendJson(ws, { type: 'error', message: 'Not connected to a room.' });
          return;
        }

        const room = rooms.get(roomPin);
        if (!room) {
          sendJson(ws, { type: 'error', message: 'Target room does not exist.' });
          return;
        }

        // Bidirectional signal relay
        if (ws.clientRole === 'host') {
          if (room.viewerWs && room.viewerWs.readyState === WebSocket.OPEN) {
            sendJson(room.viewerWs, { type: 'signal', from: 'host', data });
          }
        } else if (ws.clientRole === 'viewer') {
          if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
            sendJson(room.hostWs, { type: 'signal', from: 'viewer', data });
          }
        }
        break;
      }

      case 'leave':
        cleanupConnection(ws);
        break;

      default:
        console.warn(`[Signaling] Unknown message type: ${type}`);
        break;
    }
  });

  ws.on('close', () => {
    cleanupConnection(ws);
  });

  ws.on('error', (err) => {
    console.error('[Signaling] WebSocket client error:', err.message);
    cleanupConnection(ws);
  });
});

// Periodic heartbeat keepalive (every 25 seconds)
const keepAliveInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      cleanupConnection(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => {
  clearInterval(keepAliveInterval);
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Pure Browser Remote - Cloud Signaling Relay Server    `);
  console.log(`=======================================================`);
  console.log(` Listening on Port : ${PORT}`);
  console.log(` HTTP Health Check : http://localhost:${PORT}/health`);
  console.log(` WebSocket Relay   : ws://localhost:${PORT}`);
  console.log(` Ready for cloud deployment on Render, Railway, Glitch.`);
  console.log(`=======================================================`);
});
