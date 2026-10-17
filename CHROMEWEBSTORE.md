# Chrome Web Store Listing — Pure Browser Remote Host

> Last Updated: 2026-10-17

## Store Listing

**Extension Name** [REQUIRED]
Pure Browser Remote Host

**Short Description** [REQUIRED]
Zero-privilege pure browser remote screen sharing and web tab remote control.

**Detailed Description** [REQUIRED]
Pure Browser Remote Host enables zero-privilege, in-browser screen sharing and interactive remote tab control directly from any secondary browser without installing local executable software, Python runtimes, or administrative tools.

Key Features:
- Instant Screen & Tab Sharing: Stream your screen, application window, or individual browser tab with ultra-low latency via encrypted WebRTC peer connections.
- Interactive Remote Control: Click, scroll, and type into active web tabs directly from your phone, tablet, or another laptop.
- Account Mode & Device Registry: Register and sign into your personal account to connect to your remote workstations with a single click, or use 6-digit Guest PINs for ad-hoc sharing.
- Zero Native Dependencies: Operates 100% inside user-space browser memory without modifying system registry, requiring elevated Windows UAC permissions, or installing background background drivers.
- Complete Host Privacy: Easily toggle the remote cursor pointer on and off at any moment, and stop screen streaming with a single click.

How to Use:
1. Click the extension icon to open the Host Control Center.
2. Sign in to your account or generate a 6-digit Guest PIN.
3. Click "Share Screen / Tab" to select the display or browser tab you want to stream.
4. On your other computer, phone, or tablet, open the Remote Viewer web app and log in or enter the PIN to immediately view and interact with your session.

Privacy and Security:
All live screen video and remote mouse/keyboard commands flow directly peer-to-peer using end-to-end DTLS/SRTP encryption. No screen content, browsing history, or keystrokes are ever stored or monitored on our signaling servers.

Support & Feedback:
For questions, feature suggestions, or documentation, visit our official GitHub repository at https://github.com/Elroi-thecreator/pure-browser-remote.

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
Enables users to securely share their screen and control browser tabs remotely from another device without installing native binaries or administrative software.

**Primary Language** [REQUIRED]
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `extension/icons/icon-128.png` |
| Small Icon | 48×48 PNG | ✅ Ready | `extension/icons/icon-48.png` |
| Toolbar Icon | 16×16 PNG | ✅ Ready | `extension/icons/icon-16.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | 🟡 Needs capture | Host Control Panel (Account & PIN Modes) |
| Screenshot 2 [RECOMMENDED] | 1280×800 | 🟡 Needs capture | Remote Viewer Web App displaying active feed |
| Small Promo Tile [RECOMMENDED] | 440×280 | ⬜ Optional | Promo Tile |

### Screenshot Notes
- Screenshot 1: Display the Host Control Panel (`host.html`) showing the device connection state, active tab status, and stream preview.
- Screenshot 2: Display the Remote Viewer web client (`viewer/index.html`) demonstrating live remote interaction and navigation toolbar.

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `desktopCapture` | permissions | Required to invoke the native Chrome screen/tab capture picker (`chrome.desktopCapture.chooseDesktopMedia`) so the host user can select which screen or tab to stream over WebRTC. |
| `tabs` | permissions | Required to inspect active web tabs (url and title) so the host controller can route remote click, scroll, and keyboard events accurately to the user-selected web tab. |
| `scripting` | permissions | Required to inject the lightweight input simulation content script (`content.js`) into open web pages so remote mouse and keyboard inputs can be dispatched on the active tab. |
| `storage` | permissions | Required to save user preferences locally in `chrome.storage.local` (such as signaling relay URL, saved session token, device name, and cursor overlay visibility). |
| `offscreen` | permissions | Required in Manifest V3 to manage offscreen media processing (`offscreen.html`) and WebRTC stream lifetime when background service workers are suspended. |
| `<all_urls>` | host_permissions | Required to enable remote cursor interaction and keyboard typing simulation across any arbitrary web page or web app that the host user chooses to control. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No personal identity data is collected or tracked.

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | N/A | No |
| Health / Financial info | No | No | N/A | No |
| Authentication info | Optional | Yes (Hashed to user-configured relay) | Storing account username and PBKDF2 hashed password on the signaling relay solely to authenticate device ownership in Account Mode. | No |
| Personal communications | No | No | N/A | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | No | No | N/A | No |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Privacy Policy

**Privacy Policy URL** [REQUIRED]
`https://pure-browser-remote-relay-8bpt.onrender.com/privacy`

---

## Distribution

**Visibility**: Public
**Regions**: All regions

---

## Developer Info

**Publisher Name** [REQUIRED]
Elroi-thecreator

**Contact Email** [REQUIRED]
support@pure-browser-remote.org (or your GitHub account email)

**Support URL** [RECOMMENDED]
https://github.com/Elroi-thecreator/pure-browser-remote/issues

**Homepage URL** [RECOMMENDED]
https://github.com/Elroi-thecreator/pure-browser-remote

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-10-17 | Initial production release: Account Mode, PIN Mode, sleek SVG pointer, React-compatible input injection, and Render cloud relay. | Draft |
