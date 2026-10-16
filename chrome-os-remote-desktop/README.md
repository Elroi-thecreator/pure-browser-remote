# Chrome OS Remote Desktop & Full OS Control System

A high-performance, production-ready, peer-to-peer **Full OS Remote Desktop & Control System** powered by:
- **Chrome Extension (Manifest V3)**: Captures 60 FPS full desktop video via `getDisplayMedia` and bridges low-latency input events.
- **WebRTC (Video + SCTP DataChannel)**: Direct sub-50ms peer-to-peer display streaming and input dispatching.
- **Node.js WebSocket Signaling Server & Viewer**: Coordinates room registration and WebRTC handshakes via 6-digit PINs, hosting the responsive client viewer web app.
- **Python Native Messaging Host**: Authorized OS-level input injection engine (`pyautogui` + `pynput` + `pyperclip`) executing mouse clicks, movements, wheel scrolls, keystrokes, shortcuts, and clipboard pastes without web sandbox limitations.

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Signaling Server                     │
│               (Node.js Express + ws)                   │
│        http://localhost:3000  |  ws://localhost:3000   │
└───────────────────────────┬────────────────────────────┘
                            │
               WebSocket    │    WebSocket
               Signaling    │    Signaling
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌────────────────────────┐      ┌────────────────────────┐
│  Host Chrome Extension │      │   Remote Client Web    │
│      (Manifest V3)     │      │         Viewer         │
│                        │      │                        │
│ 1. desktopCapture      │◄────►│ 1. <video> rendering   │
│ 2. WebRTC Peer         │WebRTC│ 2. Normalized pointer  │
│ 3. DataChannel listener│ Direct  3. Keyboard capture   │
└───────────┬────────────┘Stream│ 4. Clipboard drawer    │
            │                   └────────────────────────┘
            │ stdio Native Messaging
            │ (32-bit length-prefixed JSON)
            ▼
┌────────────────────────┐
│  Python Native Host    │
│  (os_controller.py)    │
│                        │
│ • pyautogui (mouse)    │
│ • pynput (keyboard)    │
│ • pyperclip (clipboard)│
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐
│ Host Operating System  │
│ (Windows, macOS, Linux)│
└────────────────────────┘
```

---

## 2. Directory Layout

```text
chrome-os-remote-desktop/
├── extension/                        # Host Chrome Extension (Manifest V3)
│   ├── manifest.json                 # Permissions (nativeMessaging, storage) & MV3 configuration
│   ├── background.js                 # Service worker: opens dedicated Host Controller tab
│   ├── host.html                     # Host UI (Room PIN generator, connection status, logs)
│   ├── host.css                      # Modern dark-mode UI styling
│   └── host.js                       # desktopCapture + WebRTC Host + connectNative bridge
├── native-host/                      # Local OS Input Controller (Python)
│   ├── requirements.txt              # pyautogui, pynput, pyperclip
│   ├── os_controller.py              # Native Messaging stdio loop -> OS mouse/keyboard
│   ├── os_controller_win.bat         # Windows wrapper for Python script
│   ├── com.remote.oscontroller.json  # Chrome Native Messaging Host manifest template
│   ├── install_win.bat               # 1-click Windows Registry + path installer
│   └── install_unix.sh               # 1-click macOS/Linux installer
├── signaling-server/                 # WebRTC Signaling & Viewer Hosting (Node.js)
│   ├── package.json                  # express, ws, cors
│   ├── server.js                     # Express + WebSocket room/PIN signaling relay
│   └── public/                       # Remote Client Viewer Web App
│       ├── index.html                # Viewer UI (PIN input, fullscreen canvas/video, toolbar)
│       ├── style.css                 # Responsive remote desktop viewport styling
│       └── viewer.js                 # WebRTC Client + normalized mouse/key capture
└── README.md                         # Step-by-step setup and testing instructions
```

---

## 3. Prerequisites

- **Node.js**: v18.0.0 or higher
- **Python**: v3.8 or higher with `pip`
- **Google Chrome** (or Chromium / Edge / Brave)

---

## 4. Step-by-Step Installation & Setup

### Step 1: Start the Signaling Server & Web Viewer

1. Open a terminal in the project directory:
   ```bash
   cd chrome-os-remote-desktop/signaling-server
   npm install
   npm start
   ```
2. The server will launch at:
   - **Web Viewer**: `http://localhost:3000`
   - **WebSocket Signaling**: `ws://localhost:3000/ws`

---

### Step 2: Load the Host Chrome Extension

1. Open **Google Chrome** and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click **Load unpacked** in the top-left toolbar.
4. Select the folder:
   `chrome-os-remote-desktop/extension`
5. The extension **Chrome OS Remote Desktop Host** is now installed.
6. Click the extension icon in Chrome or open the automatic Host tab:
   - Note the **32-character Extension ID** displayed at the top of the Host page (e.g. `abcdefghijklmnop...`).
   - Click the **📋 Copy ID** button.

---

### Step 3: Install & Register the Python Native Messaging Host

The Native Messaging Host enables kernel-level OS mouse and keyboard input injection without browser sandbox restrictions.

#### On Windows:
1. Open a terminal or Command Prompt:
   ```cmd
   cd chrome-os-remote-desktop\native-host
   install_win.bat <PASTE_YOUR_EXTENSION_ID>
   ```
   *(If run without arguments, it will prompt you to paste the Extension ID).*
2. The script will:
   - Install required packages: `pyautogui`, `pynput`, `pyperclip`.
   - Generate `com.remote.oscontroller.json` with your Extension ID and local script path.
   - Register `com.remote.oscontroller` under Windows Registry key `HKCU\Software\Google\Chrome\NativeMessagingHosts`.

#### On macOS / Linux:
1. Open a terminal:
   ```bash
   cd chrome-os-remote-desktop/native-host
   chmod +x install_unix.sh
   ./install_unix.sh <PASTE_YOUR_EXTENSION_ID>
   ```
2. The script installs requirements and places the manifest JSON in `~/.config/google-chrome/NativeMessagingHosts/` (Linux) or `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (macOS).

---

### Step 4: Start the Remote Desktop Host Session

1. In the **Host Controller** Chrome tab (`host.html`):
   - **Verify Native Host**: The **OS Input Injection Host** card should display `Online` and show your screen resolution (e.g., `1920x1080 (Windows)`). If not, click **🔌 Connect Native Host**.
   - **Start Screen Sharing**: Click **🎥 Share Entire Screen**. In the Chrome prompt, select **Entire Screen** and click **Share**.
   - **Verify Room PIN**: A 6-digit PIN is automatically generated (e.g., `839201`).
   - **Start Hosting**: Click **🚀 Start Hosting Session**.

---

### Step 5: Connect from Remote Viewer Client

1. Open a browser window (on the same machine or any computer on the local network) and navigate to:
   `http://localhost:3000`
2. Enter the **6-Digit Room PIN** generated in the Host tab.
3. Click **Connect to Host**.
4. The WebRTC stream immediately renders at 60 FPS!

---

## 5. Control Features & Gestures

| Feature | Action / Shortcut |
| :--- | :--- |
| **Mouse Move & Cursor** | Move cursor over video; pixel-perfect mapping accounts for letterboxing |
| **Left Click / Double Click** | Standard mouse left clicks and double clicks |
| **Right Click** | Context menu is intercepted and forwarded to the host OS |
| **Mouse Scroll** | Vertical & horizontal wheel scrolling |
| **Pointer Lock** | Click **🎯 Lock Mouse** to trap the cursor inside the remote session |
| **Keyboard Input** | Full typing & keyboard shortcuts (intercepts browser defaults) |
| **Windows / Super Key** | Click **⊞ Win** button on toolbar |
| **Alt+Tab** | Click **Alt+Tab** button on toolbar |
| **Task Manager / SAS** | Click **Ctrl+Alt+Del** button on toolbar |
| **Fast Clipboard Injection** | Click **📋 Send Text**, paste arbitrary code/text, and click **Inject via OS Clipboard** |
| **Fullscreen Mode** | Click **⛶ Fullscreen** (toolbar auto-hides when mouse is stationary) |

---

## 6. Troubleshooting & Diagnostics

- **Native Host Status Shows "Offline" or "Disconnected"**:
  1. Verify you ran `install_win.bat` (or `install_unix.sh`) with the exact Extension ID shown in the Host header.
  2. Verify Python is installed and accessible from terminal (`python --version`).
  3. Inspect log file in your system temp directory:
     - Windows: `%TEMP%\os_remote_controller.log`
     - Linux/macOS: `/tmp/os_remote_controller.log`
- **Room Not Found Error on Viewer**:
  1. Confirm the Host clicked **🚀 Start Hosting Session** before the viewer attempts to connect.
  2. Ensure both the Host and Viewer are pointing to the same Signaling Server URL.
- **Firewall / Remote Network (WAN) Connections**:
  - The default configuration uses Google's public STUN servers (`stun:stun.l.google.com:19302`).
  - For restrictive symmetric corporate NATs or cellular hotspots, add a TURN server to `config.iceServers` in `extension/host.js` and `signaling-server/public/viewer.js`.

---

## 7. License

MIT License. Designed and engineered for production reliability and sub-second control latency.
