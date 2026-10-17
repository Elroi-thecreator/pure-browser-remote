const http = require('http');
const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
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

// -------------------------------------------------------------
// Persistent Auth & Device Store (Zero External DB Dependencies)
// -------------------------------------------------------------
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const DB_FILE = path.join(DATA_DIR, 'auth_registry.json');

// Memory store
const users = new Map();     // username -> { username, salt, hash, createdAt }
const sessions = new Map();  // token -> { username, expiresAt }
const devices = new Map();   // deviceId -> { deviceId, username, deviceName, isOnline, lastSeen, hostWs, viewerWs }

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const content = fs.readFileSync(DB_FILE, 'utf8');
      const data = JSON.parse(content);
      if (data.users) {
        data.users.forEach(u => users.set(u.username.toLowerCase(), u));
      }
      if (data.devices) {
        data.devices.forEach(d => {
          devices.set(d.deviceId, {
            deviceId: d.deviceId,
            username: d.username.toLowerCase(),
            deviceName: d.deviceName || 'Remote Device',
            isOnline: false,
            lastSeen: d.lastSeen || new Date().toISOString(),
            hostWs: null,
            viewerWs: null
          });
        });
      }
      console.log(`[Auth] Loaded ${users.size} user(s) and ${devices.size} device(s) from disk.`);
    }
  } catch (err) {
    console.error('[Auth] Error loading database file:', err.message);
  }
}

function saveDatabase() {
  try {
    const userArray = Array.from(users.values());
    const deviceArray = Array.from(devices.values()).map(d => ({
      deviceId: d.deviceId,
      username: d.username,
      deviceName: d.deviceName,
      lastSeen: d.lastSeen
    }));
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: userArray, devices: deviceArray }, null, 2));
  } catch (err) {
    console.error('[Auth] Error saving database file:', err.message);
  }
}

loadDatabase();

// Cryptographic helpers
function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function verifyPassword(password, salt, storedHash) {
  const hash = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'));
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function authenticateToken(req) {
  const authHeader = req.headers['authorization'];
  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7).trim();
  } else if (req.query && req.query.token) {
    token = req.query.token.trim();
  }

  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;

  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return null;
  }
  return session.username;
}

// -------------------------------------------------------------
// REST API Authentication Endpoints
// -------------------------------------------------------------
app.post('/api/auth/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  const cleanUser = username.trim().toLowerCase();
  if (cleanUser.length < 3) {
    return res.status(400).json({ error: 'Username must be at least 3 characters.' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  if (users.has(cleanUser)) {
    return res.status(409).json({ error: 'Username already taken.' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const hash = hashPassword(password, salt);

  const newUser = {
    username: cleanUser,
    salt,
    hash,
    createdAt: new Date().toISOString()
  };
  users.set(cleanUser, newUser);
  saveDatabase();

  const token = generateToken();
  sessions.set(token, {
    username: cleanUser,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
  });

  console.log(`[Auth] Registered new account: ${cleanUser}`);
  res.json({ token, username: cleanUser });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password required.' });
  }

  const cleanUser = username.trim().toLowerCase();
  const user = users.get(cleanUser);
  if (!user || !verifyPassword(password, user.salt, user.hash)) {
    return res.status(401).json({ error: 'Invalid username or password.' });
  }

  const token = generateToken();
  sessions.set(token, {
    username: cleanUser,
    expiresAt: Date.now() + 30 * 24 * 60 * 60 * 1000 // 30 days
  });

  console.log(`[Auth] Logged in account: ${cleanUser}`);
  res.json({ token, username: cleanUser });
});

app.get('/api/devices', (req, res) => {
  const username = authenticateToken(req);
  if (!username) {
    return res.status(401).json({ error: 'Unauthorized or expired session.' });
  }

  const userDevices = getUserDevices(username);
  res.json({ devices: userDevices });
});

function getUserDevices(username) {
  const list = [];
  devices.forEach((d) => {
    if (d.username === username.toLowerCase()) {
      list.push({
        deviceId: d.deviceId,
        deviceName: d.deviceName,
        isOnline: d.isOnline,
        lastSeen: d.lastSeen
      });
    }
  });
  return list;
}

// -------------------------------------------------------------
// Ephemeral PIN Rooms (Fallback for Guest Mode)
// -------------------------------------------------------------
const rooms = new Map();

app.get('/', (req, res) => {
  res.json({
    name: 'Pure Browser Remote - Cloud Signaling & Device Registry Relay',
    status: 'online',
    registeredUsers: users.size,
    totalDevices: devices.size,
    activeRooms: rooms.size,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', rooms: rooms.size });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function sendJson(ws, obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Broadcast real-time device updates to all open viewer dashboards of a user
function broadcastDeviceUpdate(username) {
  const userDeviceList = getUserDevices(username);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN && client.username === username && client.clientRole === 'viewer-dashboard') {
      sendJson(client, {
        type: 'device-list-update',
        devices: userDeviceList
      });
    }
  });
}

function cleanupClient(ws) {
  // 1. Account Device Mode (Host)
  if (ws.clientRole === 'host' && ws.deviceId) {
    const dev = devices.get(ws.deviceId);
    if (dev && dev.hostWs === ws) {
      dev.isOnline = false;
      dev.hostWs = null;
      dev.lastSeen = new Date().toISOString();
      console.log(`[Device] Host '${dev.deviceName}' (${ws.deviceId}) went OFFLINE.`);

      if (dev.viewerWs && dev.viewerWs.readyState === WebSocket.OPEN) {
        sendJson(dev.viewerWs, {
          type: 'host-disconnected',
          message: 'Host device went offline.'
        });
        dev.viewerWs = null;
      }
      broadcastDeviceUpdate(dev.username);
      saveDatabase();
    }
  }

  // 2. Account Device Mode (Viewer in active session)
  if (ws.clientRole === 'viewer' && ws.connectedDeviceId) {
    const dev = devices.get(ws.connectedDeviceId);
    if (dev && dev.viewerWs === ws) {
      dev.viewerWs = null;
      console.log(`[Device] Viewer disconnected from device '${dev.deviceName}'.`);
      if (dev.hostWs && dev.hostWs.readyState === WebSocket.OPEN) {
        sendJson(dev.hostWs, {
          type: 'viewer-disconnected',
          message: 'Viewer disconnected.'
        });
      }
    }
    ws.connectedDeviceId = null;
    if (ws.username) {
      ws.clientRole = 'viewer-dashboard';
      broadcastDeviceUpdate(ws.username);
    }
  }

  // 3. Fallback PIN Mode
  if (ws.roomPin) {
    const pin = ws.roomPin;
    const room = rooms.get(pin);
    if (room) {
      if (ws.clientRole === 'host') {
        if (room.viewerWs && room.viewerWs.readyState === WebSocket.OPEN) {
          sendJson(room.viewerWs, {
            type: 'host-disconnected',
            message: 'Host has closed the session.'
          });
        }
        rooms.delete(pin);
      } else if (ws.clientRole === 'viewer') {
        if (room.hostWs && room.hostWs.readyState === WebSocket.OPEN) {
          sendJson(room.hostWs, {
            type: 'viewer-disconnected',
            message: 'Viewer disconnected.'
          });
        }
        room.viewerWs = null;
      }
    }
  }
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.clientRole = null;
  ws.username = null;
  ws.deviceId = null;
  ws.connectedDeviceId = null;
  ws.roomPin = null;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      sendJson(ws, { type: 'error', message: 'Malformed JSON payload.' });
      return;
    }

    const { type, token, deviceId, deviceName, pin, data } = msg;

    switch (type) {
      case 'ping':
        sendJson(ws, { type: 'pong', timestamp: Date.now() });
        break;

      // ---------------------------------------------------------
      // 1. Account Mode: Host Registration
      // ---------------------------------------------------------
      case 'auth-host': {
        const session = sessions.get(token);
        if (!session || Date.now() > session.expiresAt) {
          sendJson(ws, { type: 'error', code: 'AUTH_FAILED', message: 'Invalid or expired login session.' });
          return;
        }

        const username = session.username;
        const assignedDeviceId = (deviceId || crypto.randomBytes(8).toString('hex')).trim();
        const cleanName = (deviceName || 'Work Station').trim();

        ws.username = username;
        ws.clientRole = 'host';
        ws.deviceId = assignedDeviceId;

        const devObj = devices.get(assignedDeviceId) || {
          deviceId: assignedDeviceId,
          username: username,
          deviceName: cleanName,
          createdAt: new Date().toISOString()
        };

        devObj.username = username;
        devObj.deviceName = cleanName;
        devObj.isOnline = true;
        devObj.hostWs = ws;
        devObj.lastSeen = new Date().toISOString();
        devices.set(assignedDeviceId, devObj);

        saveDatabase();
        console.log(`[Host] Device '${cleanName}' (${assignedDeviceId}) registered under @${username}`);

        sendJson(ws, {
          type: 'host-authenticated',
          deviceId: assignedDeviceId,
          deviceName: cleanName,
          username: username,
          message: 'Device online and registered.'
        });

        broadcastDeviceUpdate(username);
        break;
      }

      // ---------------------------------------------------------
      // 2. Account Mode: Viewer Dashboard Subscription
      // ---------------------------------------------------------
      case 'auth-viewer': {
        const session = sessions.get(token);
        if (!session || Date.now() > session.expiresAt) {
          sendJson(ws, { type: 'error', code: 'AUTH_FAILED', message: 'Invalid or expired login session.' });
          return;
        }

        ws.username = session.username;
        ws.clientRole = 'viewer-dashboard';

        const userDeviceList = getUserDevices(session.username);
        sendJson(ws, {
          type: 'viewer-authenticated',
          username: session.username,
          devices: userDeviceList
        });
        break;
      }

      // ---------------------------------------------------------
      // 3. Account Mode: Connect to Device from Dashboard
      // ---------------------------------------------------------
      case 'connect-device': {
        if (!ws.username) {
          sendJson(ws, { type: 'error', message: 'Viewer not authenticated.' });
          return;
        }

        const dev = devices.get(deviceId);
        if (!dev || dev.username !== ws.username) {
          sendJson(ws, { type: 'error', message: 'Device not found in your account.' });
          return;
        }

        if (!dev.isOnline || !dev.hostWs || dev.hostWs.readyState !== WebSocket.OPEN) {
          sendJson(ws, { type: 'error', code: 'DEVICE_OFFLINE', message: `Device '${dev.deviceName}' is currently offline.` });
          return;
        }

        ws.clientRole = 'viewer';
        ws.connectedDeviceId = deviceId;
        dev.viewerWs = ws;

        console.log(`[Connect] Connecting viewer @${ws.username} to device '${dev.deviceName}'`);

        sendJson(ws, {
          type: 'device-accepted',
          deviceId: dev.deviceId,
          deviceName: dev.deviceName,
          message: 'Connected to device. Initiating WebRTC...'
        });

        // Trigger Host to generate WebRTC offer for this viewer
        sendJson(dev.hostWs, {
          type: 'viewer-joined',
          deviceId: dev.deviceId,
          deviceName: dev.deviceName
        });
        break;
      }

      // ---------------------------------------------------------
      // 4. Signal Relay (Handles both Account Mode & PIN Mode)
      // ---------------------------------------------------------
      case 'signal': {
        // Account Mode Relay
        if (ws.deviceId) {
          const dev = devices.get(ws.deviceId);
          if (dev && dev.viewerWs && dev.viewerWs.readyState === WebSocket.OPEN) {
            sendJson(dev.viewerWs, { type: 'signal', from: 'host', data });
          }
          return;
        } else if (ws.connectedDeviceId) {
          const dev = devices.get(ws.connectedDeviceId);
          if (dev && dev.hostWs && dev.hostWs.readyState === WebSocket.OPEN) {
            sendJson(dev.hostWs, { type: 'signal', from: 'viewer', data });
          }
          return;
        }

        // Fallback PIN Mode Relay
        if (ws.roomPin) {
          const room = rooms.get(ws.roomPin);
          if (!room) return;
          if (ws.clientRole === 'host' && room.viewerWs) {
            sendJson(room.viewerWs, { type: 'signal', from: 'host', data });
          } else if (ws.clientRole === 'viewer' && room.hostWs) {
            sendJson(room.hostWs, { type: 'signal', from: 'viewer', data });
          }
        }
        break;
      }

      // ---------------------------------------------------------
      // 5. Fallback PIN Mode (Guest Access)
      // ---------------------------------------------------------
      case 'register-host': {
        const cleanPin = (pin || '').trim();
        if (!cleanPin) return;

        ws.roomPin = cleanPin;
        ws.clientRole = 'host';

        const roomObj = rooms.get(cleanPin) || {
          pin: cleanPin,
          hostWs: ws,
          viewerWs: null,
          createdAt: new Date().toISOString()
        };
        roomObj.hostWs = ws;
        rooms.set(cleanPin, roomObj);

        sendJson(ws, { type: 'host-registered', pin: cleanPin });
        if (roomObj.viewerWs && roomObj.viewerWs.readyState === WebSocket.OPEN) {
          sendJson(roomObj.viewerWs, { type: 'host-ready', pin: cleanPin });
          sendJson(ws, { type: 'viewer-joined', pin: cleanPin });
        }
        break;
      }

      case 'join-viewer': {
        const cleanPin = (pin || '').trim();
        const room = rooms.get(cleanPin);
        if (!room || !room.hostWs || room.hostWs.readyState !== WebSocket.OPEN) {
          sendJson(ws, { type: 'error', message: `No active host found for PIN: ${cleanPin}` });
          return;
        }

        ws.roomPin = cleanPin;
        ws.clientRole = 'viewer';
        room.viewerWs = ws;

        sendJson(ws, { type: 'viewer-accepted', pin: cleanPin });
        sendJson(room.hostWs, { type: 'viewer-joined', pin: cleanPin });
        break;
      }

      case 'leave':
        cleanupClient(ws);
        break;

      default:
        break;
    }
  });

  ws.on('close', () => cleanupClient(ws));
  ws.on('error', () => cleanupClient(ws));
});

// Heartbeat keepalive (every 25 seconds)
const keepAliveInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) {
      cleanupClient(ws);
      return ws.terminate();
    }
    ws.isAlive = false;
    ws.ping();
  });
}, 25000);

wss.on('close', () => clearInterval(keepAliveInterval));

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` Pure Browser Remote - Account & Device Relay Server   `);
  console.log(`=======================================================`);
  console.log(` Port              : ${PORT}`);
  console.log(` Mode              : Account Login + Device Dashboard  `);
  console.log(` Fallback          : Guest PIN Pairing                 `);
  console.log(` Ready for cloud deployment on Render, Railway, Glitch.`);
  console.log(`=======================================================`);
});
