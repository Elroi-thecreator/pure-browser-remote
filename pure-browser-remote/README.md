# Pure Browser Remote (Manifest V3 - Non-Admin)

A 100% pure, in-browser **Screen & Web Tab Remote Control System** built on Chrome Extensions (Manifest V3), WebRTC, and Content Script DOM event synthesis.

**Zero Native Binaries. Zero Python. Zero Registry Changes. Zero Admin Privileges Required.**

---

## 1. System Architecture

```
┌────────────────────────────────────────────────────────┐
│               Cloud Signaling Server                   │
│               (Node.js Express + ws)                   │
│        Deployable on Render, Railway, or Glitch        │
│       http://your-app.onrender.com (Viewer + WS)       │
└───────────────────────────┬────────────────────────────┘
                            │
               WebSocket    │    WebSocket
               Signaling    │    Signaling
                            │
            ┌───────────────┴───────────────┐
            │                               │
            ▼                               ▼
┌────────────────────────┐      ┌────────────────────────┐
│  Host Chrome Extension │      │   Remote Web Viewer    │
│      (Manifest V3)     │      │   (Mobile or Laptop)   │
│                        │      │                        │
│ 1. desktopCapture      │◄────►│ 1. <video> playback    │
│ 2. WebRTC Peer         │WebRTC│ 2. Normalized coords   │
│ 3. DataChannel         │ Direct  3. Touch/Click events │
└───────────┬────────────┘Stream│ 4. Remote address bar  │
            │                   └────────────────────────┘
            │ chrome.tabs.sendMessage
            │ (Internal Browser IPC)
            ▼
┌────────────────────────┐
│   Host Web Page Tabs   │
│      (content.js)      │
│                        │
│ • Synthetic MouseEvent │
│ • Synthetic InputEvent │
│ • Reactive DOM updates │
│ • Visual Remote Pointer│
└────────────────────────┘
```

---

## 2. Directory Layout

```text
pure-browser-remote/
├── extension/                        # Host Chrome Extension (Manifest V3, Non-Admin)
│   ├── manifest.json                 # Permissions (desktopCapture, tabs, scripting, offscreen)
│   ├── background.js                 # Service worker: opens host control panel & manages IPC
│   ├── host.html                     # Host UI (Room PIN, connection status, view toggle)
│   ├── host.js                       # desktopCapture + WebRTC peer connection
│   ├── content.js                    # Injected script: simulates clicks & typing in host tabs
│   └── offscreen.html                # Offscreen document for handling WebRTC stream processing
├── signaling-server/                 # Cloud Signaling Relay (Node.js)
│   ├── package.json                  # express, ws, cors
│   └── server.js                     # Room-based WebSocket signaling relay & static viewer host
└── viewer/                           # Remote Viewer Web App (Client)
    ├── index.html                    # Viewer UI (PIN input, video feed, remote toolbar)
    ├── style.css                     # Responsive viewport & overlay styles (Mobile/Desktop)
    └── viewer.js                     # WebRTC Client + normalized mouse/keyboard capture
```

---

## 3. How It Works (Without Admin Privileges)

Traditional remote desktop software requires OS-level device drivers or native messaging hosts (`pyautogui`, native binaries) to synthesize system-wide clicks. 

**Pure Browser Remote** operates entirely within the Chrome web sandbox:
1. **Screen/Tab Capture**: Utilizes `chrome.desktopCapture` and `navigator.mediaDevices.getDisplayMedia` to capture the display or specific browser tabs at 60 FPS.
2. **Direct WebRTC Stream**: Establishes an encrypted peer-to-peer WebRTC connection (`RTCPeerConnection` + `RTCDataChannel`) directly between the Host and the Remote Viewer.
3. **In-Tab DOM Event Injection (`content.js`)**: When the remote user clicks, scrolls, or types, normalized coordinates `[0.0, 1.0]` are dispatched directly to the active web tab. The injected `content.js` resolves `document.elementFromPoint()`, dispatches synthetic `MouseEvent`, `KeyboardEvent`, and `InputEvent` pipelines, and updates form fields in React, Vue, Angular, or vanilla pages.
4. **Visual Remote Pointer**: A floating glowing indicator hovers on the host's screen in real time, giving visual confirmation of the remote user's movements and clicks.
5. **Remote Address Bar**: The remote user can enter any URL (e.g., `wikipedia.org`) in their viewer toolbar, instructing the host browser to navigate the active tab via `chrome.tabs.update`.

---

## 4. Quick Start & Testing

### Step 1: Start the Signaling Server
```bash
cd pure-browser-remote/signaling-server
npm install
npm start
```
*The signaling relay and remote viewer are now active at `http://localhost:8080`.*

### Step 2: Load the Extension in Chrome
1. Open **Google Chrome** and navigate to `chrome://extensions/`.
2. Turn on **Developer mode** (top-right switch).
3. Click **Load unpacked** and select the folder:
   `pure-browser-remote/extension`
4. The **Host Control Center** tab (`host.html`) will automatically open.

### Step 3: Start Screen Sharing & Choose Host Mode

#### Option A: Account Mode (Recommended - Zero PIN, 1-Click Connect)
1. On the **Host Control Center** page, select the **👤 Account Mode** tab.
2. Sign in with your username & password (or click **✨ Register New Account** if first time).
3. Set your workstation's name (e.g. `Office PC`, `Work Laptop`).
4. Click **🎥 Share Screen / Tab** and select your entire screen or a specific tab.
5. Your device is now registered and marked **Online** in your account!

#### Option B: Guest PIN Mode (Fallback)
1. Select the **🔑 Guest PIN Mode** tab.
2. Note the 6-digit **Room PIN** (e.g. `481923`).
3. Click **🚀 Start Guest Hosting**.

---

### Step 4: Connect from Any Phone or Laptop

#### Via Account Dashboard (1-Click):
1. Open the Viewer on your phone or laptop: `https://your-app.onrender.com` (or `http://localhost:8080`).
2. Log in with your username & password.
3. You will see **My Remote Workstations** showing live online/offline presence for all your computers.
4. Click **Connect 🚀** next to your workstation. WebRTC connects automatically!

#### Via Guest PIN:
1. Select the **🔑 Guest PIN** tab on the Viewer.
2. Enter the 6-digit PIN and tap **Connect to Host via PIN**.

---

### Step 5: Remote Control & Navigation Features

- **Click / Tap**: Interacts with links, buttons, and form inputs on the active web page.
- **Page Scrolling**:
  - **Mouse Wheel**: Smoothly scrolls web pages and scrollable containers.
  - **Toolbar Buttons**: Click **▲ Up**, **▼ Down**, **⬆ Top**, or **⬇ Bottom** in the top bar.
  - **On-Screen Floating Dock**: Tap the floating dock buttons (**▲ / ▼**) on mobile devices.
  - **Keyboard Navigation**: Press **Arrow Up / Down**, **Page Up / Down**, or **Home / End** to navigate pages.
- **Type Text**: Click **⌨️ Type Text** in the toolbar to inject queries or passwords directly into the active field.
- **Remote Address Bar**: Type any website URL in the top address bar and click **Go** to browse the web remotely.
- **Switch Back to Dashboard**: In Account Mode, click **◀ Dashboard** at any time to return to your workstation list.

---

## 5. 1-Click Cloud Deployment (Render / Railway / Glitch)

Deploy the signaling relay so it is accessible from anywhere on the internet without port forwarding:

### Deploy to Render:
1. Push this repository to GitHub.
2. In [Render Dashboard](https://dashboard.render.com/), create a new **Web Service** or use the included `render.yaml` Blueprint.
3. Set:
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
4. Copy your service URL (e.g. `https://pure-remote.onrender.com`).
5. In the Host Extension, set the Signaling URL to `wss://pure-remote.onrender.com`.
6. Open `https://pure-remote.onrender.com` on any smartphone or computer to connect!

---

## 6. Features Matrix

| Capability | Pure Browser Remote | Native Remote Control |
| :--- | :--- | :--- |
| **Admin Privileges Required** | **NO (0% Admin)** | YES |
| **Native Binaries / Python** | **NONE** | Required |
| **Account-Based Device Dashboard** | **YES (Zero PIN 1-Click)** | Often requires cloud account |
| **Guest PIN Code Pairing** | **YES (Instant fallback)** | Common |
| **Install Friction** | 1-click extension load | Multi-step registry & pip setup |
| **Works on Chromebooks** | **YES** | NO |
| **Full Page Scrolling** | **Wheel + Touch Dock + Keys** | OS-level |
| **Web Tab Control & Typing** | **Full DOM Injection** | OS-level |
| **Remote Address Bar** | **YES** | NO |
| **Visual Remote Pointer** | **Built-in glowing overlay** | OS cursor |
| **Mobile Web Access** | **YES (Touch gestures & dock)** | Requires native client app |

