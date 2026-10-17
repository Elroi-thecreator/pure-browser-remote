// Pure Browser Remote - Host Controller Logic
(function () {
  'use strict';

  // DOM Elements - Status Banner
  const signalingDot = document.getElementById('signalingDot');
  const signalingStatusText = document.getElementById('signalingStatusText');
  const accountDot = document.getElementById('accountDot');
  const accountStatusText = document.getElementById('accountStatusText');
  const captureDot = document.getElementById('captureDot');
  const captureStatusText = document.getElementById('captureStatusText');
  const webrtcDot = document.getElementById('webrtcDot');
  const webrtcStatusText = document.getElementById('webrtcStatusText');
  const targetTabStatus = document.getElementById('targetTabStatus');

  // DOM Elements - Navigation & Modes
  const tabBtnAccount = document.getElementById('tabBtnAccount');
  const tabBtnPin = document.getElementById('tabBtnPin');
  const roomBadge = document.getElementById('roomBadge');
  const signalingUrlInput = document.getElementById('signalingUrl');

  // DOM Elements - Account Mode
  const accountLoggedOutSection = document.getElementById('accountLoggedOutSection');
  const accountLoggedInSection = document.getElementById('accountLoggedInSection');
  const hostUsername = document.getElementById('hostUsername');
  const hostPassword = document.getElementById('hostPassword');
  const hostDeviceName = document.getElementById('hostDeviceName');
  const btnHostLogin = document.getElementById('btnHostLogin');
  const btnHostRegister = document.getElementById('btnHostRegister');
  const accountUserLabel = document.getElementById('accountUserLabel');
  const accountDeviceLabel = document.getElementById('accountDeviceLabel');
  const accountDeviceIdLabel = document.getElementById('accountDeviceIdLabel');
  const accountOnlineBadge = document.getElementById('accountOnlineBadge');
  const btnReconnectHost = document.getElementById('btnReconnectHost');
  const btnDisconnectHost = document.getElementById('btnDisconnectHost');
  const btnHostLogout = document.getElementById('btnHostLogout');

  // DOM Elements - PIN Mode
  const pinModeSection = document.getElementById('pinModeSection');
  const pinDisplay = document.getElementById('pinDisplay');
  const btnGeneratePin = document.getElementById('btnGeneratePin');
  const btnCopyPin = document.getElementById('btnCopyPin');
  const btnStartHosting = document.getElementById('btnStartHosting');
  const btnStopHosting = document.getElementById('btnStopHosting');
  const viewerWebUrl = document.getElementById('viewerWebUrl');
  const btnCopyViewerUrl = document.getElementById('btnCopyViewerUrl');

  // DOM Elements - Screen Capture & Preview
  const localPreview = document.getElementById('localPreview');
  const noStreamPlaceholder = document.getElementById('noStreamPlaceholder');
  const captureBadge = document.getElementById('captureBadge');
  const btnStartCapture = document.getElementById('btnStartCapture');
  const btnStopCapture = document.getElementById('btnStopCapture');

  // DOM Elements - In-Tab DOM Controls
  const activeTabTitle = document.getElementById('activeTabTitle');
  const activeTabUrl = document.getElementById('activeTabUrl');
  const toggleRemoteCursor = document.getElementById('toggleRemoteCursor');
  const toggleLocalPreview = document.getElementById('toggleLocalPreview');
  const quickUrlInput = document.getElementById('quickUrlInput');
  const btnQuickOpen = document.getElementById('btnQuickOpen');

  // DOM Elements - Console Log & Toasts
  const consoleLog = document.getElementById('consoleLog');
  const autoScrollCheck = document.getElementById('autoScrollCheck');
  const btnClearConsole = document.getElementById('btnClearConsole');
  const toastContainer = document.getElementById('toastContainer');

  // Internal State
  let captureStream = null;
  let signalingWs = null;
  let pc = null;
  let dataChannel = null;
  let currentPin = '';
  let pendingCandidates = [];
  let lastLoggedInputTime = 0;

  let activeMode = 'account'; // 'account' | 'pin'
  let currentToken = null;
  let currentUsername = null;
  let currentDeviceId = null;
  let currentDeviceName = 'Work Station';
  let isAccountHostActive = false;
  let isPinHostActive = false;

  let reconnectTimer = null;
  let reconnectAttempts = 0;
  let isManualDisconnect = false;

  function showToast(message, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function log(message, type = 'info') {
    const timeStr = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${timeStr}] ${message}`;
    consoleLog.appendChild(entry);

    while (consoleLog.children.length > 250) {
      consoleLog.removeChild(consoleLog.firstChild);
    }

    if (autoScrollCheck.checked) {
      consoleLog.scrollTop = consoleLog.scrollHeight;
    }
  }

  // -------------------------------------------------------------
  // Smart URL Normalization (Auto-Upgrade to wss:// for Cloud Hosts)
  // -------------------------------------------------------------
  function normalizeWsUrl(url) {
    let cleaned = (url || '').trim();
    if (!cleaned) return 'ws://localhost:8080';

    // Convert http/https to ws/wss
    if (cleaned.startsWith('https://')) {
      cleaned = cleaned.replace('https://', 'wss://');
    } else if (cleaned.startsWith('http://')) {
      cleaned = cleaned.replace('http://', 'ws://');
    }

    // Add protocol if user typed raw domain
    if (!cleaned.startsWith('ws://') && !cleaned.startsWith('wss://')) {
      if (cleaned.includes('localhost') || cleaned.includes('127.0.0.1')) {
        cleaned = 'ws://' + cleaned;
      } else {
        cleaned = 'wss://' + cleaned;
      }
    }

    // CRITICAL: Cloud platforms (Render, Railway, Fly) terminate SSL and redirect ws:// -> 301.
    // WebSockets cannot follow 301 redirects in Chrome, so remote hosts MUST use wss://.
    if (cleaned.startsWith('ws://') && !cleaned.includes('localhost') && !cleaned.includes('127.0.0.1')) {
      log(`[Signaling] Cloud host detected with ws://. Auto-upgraded to secure wss:// for Render/TLS compatibility.`, 'warn');
      cleaned = cleaned.replace('ws://', 'wss://');
    }

    return cleaned.replace(/\/+$/, '');
  }

  function getHttpBaseUrl() {
    const raw = normalizeWsUrl(signalingUrlInput.value.trim());
    if (raw.startsWith('wss://')) {
      return raw.replace('wss://', 'https://');
    }
    if (raw.startsWith('ws://')) {
      return raw.replace('ws://', 'http://');
    }
    return raw;
  }

  // -------------------------------------------------------------
  // Mode Tab Navigation
  // -------------------------------------------------------------
  function switchMode(mode) {
    activeMode = mode;
    if (mode === 'account') {
      tabBtnAccount.classList.add('active');
      tabBtnPin.classList.remove('active');
      pinModeSection.classList.add('hidden');
      if (currentToken) {
        accountLoggedOutSection.classList.add('hidden');
        accountLoggedInSection.classList.remove('hidden');
      } else {
        accountLoggedOutSection.classList.remove('hidden');
        accountLoggedInSection.classList.add('hidden');
      }
    } else {
      tabBtnPin.classList.add('active');
      tabBtnAccount.classList.remove('active');
      accountLoggedOutSection.classList.add('hidden');
      accountLoggedInSection.classList.add('hidden');
      pinModeSection.classList.remove('hidden');
    }
    chrome.storage.local.set({ pbr_active_mode: mode });
  }

  tabBtnAccount.addEventListener('click', () => switchMode('account'));
  tabBtnPin.addEventListener('click', () => switchMode('pin'));

  // -------------------------------------------------------------
  // Persistent Device ID & Settings
  // -------------------------------------------------------------
  async function initPersistence() {
    return new Promise((resolve) => {
      chrome.storage.local.get([
        'pbr_token',
        'pbr_username',
        'pbr_device_id',
        'pbr_device_name',
        'pbr_signaling_url',
        'pbr_active_mode'
      ], (items) => {
        if (items.pbr_signaling_url) {
          signalingUrlInput.value = normalizeWsUrl(items.pbr_signaling_url);
        } else {
          signalingUrlInput.value = 'ws://localhost:8080';
        }

        if (items.pbr_device_id) {
          currentDeviceId = items.pbr_device_id;
        } else {
          currentDeviceId = 'dev_' + Math.random().toString(36).substring(2, 10);
          chrome.storage.local.set({ pbr_device_id: currentDeviceId });
        }

        if (items.pbr_device_name) {
          currentDeviceName = items.pbr_device_name;
          hostDeviceName.value = currentDeviceName;
        }

        if (items.pbr_token && items.pbr_username) {
          currentToken = items.pbr_token;
          currentUsername = items.pbr_username;
          renderLoggedInUi();
          autoConnectAccountHost();
        }

        if (items.pbr_active_mode) {
          switchMode(items.pbr_active_mode);
        } else {
          switchMode('account');
        }

        generateRandomPin();
        updateViewerUrl();
        updateActiveTabDisplay();
        resolve();
      });
    });
  }

  function renderLoggedInUi() {
    accountUserLabel.textContent = `@${currentUsername}`;
    accountDeviceLabel.textContent = currentDeviceName;
    accountDeviceIdLabel.textContent = currentDeviceId;
    accountLoggedOutSection.classList.add('hidden');
    accountLoggedInSection.classList.remove('hidden');
    accountDot.className = 'dot dot-active';
    accountStatusText.textContent = `@${currentUsername} (${currentDeviceName})`;
  }

  function renderLoggedOutUi() {
    currentToken = null;
    currentUsername = null;
    chrome.storage.local.remove(['pbr_token', 'pbr_username']);
    accountLoggedOutSection.classList.remove('hidden');
    accountLoggedInSection.classList.add('hidden');
    accountDot.className = 'dot dot-inactive';
    accountStatusText.textContent = 'Logged Out';
    roomBadge.className = 'badge badge-warn';
    roomBadge.textContent = 'Offline';
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  }

  // -------------------------------------------------------------
  // Account Mode: Auth API & WebSocket Registration
  // -------------------------------------------------------------
  async function performAuth(action) {
    const username = hostUsername.value.trim();
    const password = hostPassword.value.trim();
    const devName = hostDeviceName.value.trim() || 'Work Station';

    if (!username || username.length < 3) {
      showToast('Username must be at least 3 characters.', 'error');
      return;
    }
    if (!password || password.length < 6) {
      showToast('Password must be at least 6 characters.', 'error');
      return;
    }

    // Normalize URL before making HTTP request
    const normUrl = normalizeWsUrl(signalingUrlInput.value);
    signalingUrlInput.value = normUrl;
    chrome.storage.local.set({ pbr_signaling_url: normUrl });

    const endpoint = action === 'login' ? '/api/auth/login' : '/api/auth/register';
    const httpBase = getHttpBaseUrl();

    log(`Authenticating with ${httpBase}${endpoint}...`, 'info');

    try {
      const resp = await fetch(`${httpBase}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Authentication failed');
      }

      currentToken = data.token;
      currentUsername = data.username;
      currentDeviceName = devName;

      chrome.storage.local.set({
        pbr_token: currentToken,
        pbr_username: currentUsername,
        pbr_device_name: currentDeviceName
      });

      showToast(`Welcome @${currentUsername}! Device registering...`, 'success');
      log(`Logged in as @${currentUsername}. Registering host socket...`, 'success');
      renderLoggedInUi();
      connectAccountHostSocket();
    } catch (err) {
      log(`Auth failed: ${err.message}`, 'error');
      showToast(err.message, 'error');
    }
  }

  btnHostLogin.addEventListener('click', () => performAuth('login'));
  btnHostRegister.addEventListener('click', () => performAuth('register'));

  btnHostLogout.addEventListener('click', () => {
    isManualDisconnect = true;
    disconnectCurrentSession();
    renderLoggedOutUi();
    showToast('Logged out of host account.');
    log('Host logged out.', 'info');
  });

  btnDisconnectHost.addEventListener('click', () => {
    isManualDisconnect = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    disconnectCurrentSession();
    roomBadge.className = 'badge badge-warn';
    roomBadge.textContent = 'Offline';
    accountOnlineBadge.className = 'badge badge-neutral';
    accountOnlineBadge.textContent = 'Standby (Offline)';
    btnReconnectHost.classList.remove('hidden');
    btnDisconnectHost.classList.add('hidden');
    log('Host disconnected from relay. Click "Connect Device" to reconnect.', 'warn');
  });

  btnReconnectHost.addEventListener('click', () => {
    reconnectAttempts = 0;
    isManualDisconnect = false;
    log('Manual reconnect requested...', 'info');
    connectAccountHostSocket();
  });

  function autoConnectAccountHost() {
    if (currentToken && activeMode === 'account') {
      log(`Auto-reconnecting device '${currentDeviceName}' for @${currentUsername}...`, 'info');
      connectAccountHostSocket();
    }
  }

  function scheduleReconnect() {
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectAttempts++;
    const delay = Math.min(2500 * Math.pow(1.3, reconnectAttempts - 1), 12000);
    const delaySec = Math.round(delay / 1000);

    accountOnlineBadge.className = 'badge badge-warn';
    accountOnlineBadge.textContent = `Reconnecting in ${delaySec}s...`;
    roomBadge.className = 'badge badge-warn';
    roomBadge.textContent = 'Reconnecting...';

    log(`Signaling connection dropped. Reconnecting in ${delaySec}s (attempt ${reconnectAttempts})...`, 'warn');

    reconnectTimer = setTimeout(() => {
      if (currentToken && activeMode === 'account' && !isManualDisconnect) {
        connectAccountHostSocket();
      }
    }, delay);
  }

  function connectAccountHostSocket() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    isManualDisconnect = false;
    const wsUrl = normalizeWsUrl(signalingUrlInput.value);
    signalingUrlInput.value = wsUrl; // reflect normalized URL in UI
    chrome.storage.local.set({ pbr_signaling_url: wsUrl });

    disconnectSignalingWs();

    accountOnlineBadge.className = 'badge badge-warn';
    accountOnlineBadge.textContent = 'Connecting...';
    roomBadge.className = 'badge badge-warn';
    roomBadge.textContent = 'Connecting...';

    log(`Opening WebSocket to: ${wsUrl}...`, 'info');

    try {
      signalingWs = new WebSocket(wsUrl);
    } catch (e) {
      log(`WebSocket error: ${e.message}`, 'error');
      scheduleReconnect();
      return;
    }

    signalingWs.onopen = () => {
      reconnectAttempts = 0;
      signalingDot.className = 'dot dot-active';
      signalingStatusText.textContent = 'Connected';
      log(`WebSocket connected to ${wsUrl}. Registering device '${currentDeviceName}'...`, 'info');

      sendWsMessage({
        type: 'auth-host',
        token: currentToken,
        deviceId: currentDeviceId,
        deviceName: currentDeviceName
      });
    };

    signalingWs.onmessage = async (evt) => {
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch (e) {
        return;
      }

      const { type, data, deviceId, deviceName, username, message } = msg;

      switch (type) {
        case 'host-authenticated':
          isAccountHostActive = true;
          reconnectAttempts = 0;
          roomBadge.className = 'badge badge-success';
          roomBadge.textContent = 'Listed & Online';
          accountOnlineBadge.className = 'badge badge-success';
          accountOnlineBadge.textContent = 'Online & Listed';
          btnReconnectHost.classList.add('hidden');
          btnDisconnectHost.classList.remove('hidden');
          webrtcDot.className = 'dot dot-pending';
          webrtcStatusText.textContent = 'Awaiting Viewer Call';
          log(`Device registered and listed online: '${deviceName}' (${deviceId}) under @${username}`, 'success');
          showToast(`Device '${deviceName}' online in your account!`);
          break;

        case 'viewer-joined':
          log(`Remote viewer requested connection to device '${deviceName || currentDeviceName}'! Initiating WebRTC...`, 'success');
          showToast('Viewer connecting to this device!');
          await initiateWebRtcOffer();
          break;

        case 'signal':
          await handleSignalData(data);
          break;

        case 'viewer-disconnected':
          log('Remote viewer disconnected.', 'warn');
          webrtcDot.className = 'dot dot-pending';
          webrtcStatusText.textContent = 'Awaiting Viewer Call';
          if (pc) {
            pc.close();
            pc = null;
          }
          break;

        case 'error':
          log(`Relay message: ${message}`, 'error');
          if (msg.code === 'AUTH_FAILED') {
            renderLoggedOutUi();
            showToast('Session expired. Please log in again.', 'error');
          }
          break;

        default:
          break;
      }
    };

    signalingWs.onerror = () => {
      signalingDot.className = 'dot dot-inactive';
      signalingStatusText.textContent = 'Error';
      log(`WebSocket error on ${wsUrl}. Verify server is online and requires wss:// on cloud platforms.`, 'error');
    };

    signalingWs.onclose = () => {
      signalingDot.className = 'dot dot-inactive';
      signalingStatusText.textContent = 'Disconnected';
      isAccountHostActive = false;
      btnReconnectHost.classList.remove('hidden');
      btnDisconnectHost.classList.add('hidden');

      if (!isManualDisconnect && currentToken && activeMode === 'account') {
        scheduleReconnect();
      } else {
        accountOnlineBadge.className = 'badge badge-neutral';
        accountOnlineBadge.textContent = 'Standby (Offline)';
        roomBadge.className = 'badge badge-warn';
        roomBadge.textContent = 'Offline';
      }
    };
  }

  // -------------------------------------------------------------
  // Guest PIN Mode Logic
  // -------------------------------------------------------------
  function generateRandomPin() {
    currentPin = Math.floor(100000 + Math.random() * 900000).toString();
    pinDisplay.textContent = currentPin;
    updateViewerUrl();
    log(`Generated new room PIN: ${currentPin}`, 'info');
  }

  function updateViewerUrl() {
    const rawUrl = normalizeWsUrl(signalingUrlInput.value.trim());
    let httpUrl = 'http://localhost:8080/viewer/';
    try {
      if (rawUrl.startsWith('ws://')) {
        httpUrl = rawUrl.replace('ws://', 'http://') + '/viewer/';
      } else if (rawUrl.startsWith('wss://')) {
        httpUrl = rawUrl.replace('wss://', 'https://') + '/viewer/';
      }
    } catch (e) {}
    viewerWebUrl.value = `${httpUrl}?pin=${currentPin}`;
  }

  function startPinHosting() {
    const url = normalizeWsUrl(signalingUrlInput.value.trim());
    signalingUrlInput.value = url;
    chrome.storage.local.set({ pbr_signaling_url: url });

    if (!url) {
      showToast('Enter a valid Signaling WebSocket URL', 'error');
      return;
    }

    if (!currentPin) generateRandomPin();

    disconnectSignalingWs();

    try {
      signalingWs = new WebSocket(url);
    } catch (err) {
      log(`WebSocket error: ${err.message}`, 'error');
      showToast(`Invalid WebSocket URL: ${err.message}`, 'error');
      return;
    }

    signalingWs.onopen = () => {
      log(`Connected to Signaling Server. Registering Room PIN: ${currentPin}`, 'success');
      signalingDot.className = 'dot dot-active';
      signalingStatusText.textContent = 'Connected';

      sendWsMessage({
        type: 'register-host',
        pin: currentPin
      });
    };

    signalingWs.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      const { type, data, pin, message } = msg;

      switch (type) {
        case 'host-registered':
          isPinHostActive = true;
          roomBadge.className = 'badge badge-success';
          roomBadge.textContent = `PIN Hosting (${currentPin})`;
          btnStartHosting.classList.add('hidden');
          btnStopHosting.classList.remove('hidden');
          webrtcDot.className = 'dot dot-pending';
          webrtcStatusText.textContent = `Awaiting Viewer (PIN: ${currentPin})`;
          log(`Guest session active. Share PIN ${currentPin} with viewer.`, 'success');
          showToast(`Hosting on PIN ${currentPin}`);
          break;

        case 'viewer-joined':
          log(`Remote viewer joined PIN ${pin}! Initiating WebRTC handshake...`, 'success');
          await initiateWebRtcOffer();
          break;

        case 'signal':
          await handleSignalData(data);
          break;

        case 'viewer-disconnected':
          log('Remote viewer disconnected.', 'warn');
          webrtcDot.className = 'dot dot-pending';
          webrtcStatusText.textContent = `Awaiting Viewer (PIN: ${currentPin})`;
          if (pc) {
            pc.close();
            pc = null;
          }
          break;

        case 'error':
          log(`Signaling Error: ${message}`, 'error');
          showToast(message, 'error');
          break;

        default:
          break;
      }
    };

    signalingWs.onerror = () => {
      signalingDot.className = 'dot dot-inactive';
      signalingStatusText.textContent = 'Error';
    };

    signalingWs.onclose = () => {
      signalingDot.className = 'dot dot-inactive';
      signalingStatusText.textContent = 'Disconnected';
      isPinHostActive = false;
      btnStartHosting.classList.remove('hidden');
      btnStopHosting.classList.add('hidden');
    };
  }

  function stopPinHosting() {
    disconnectSignalingWs();
    isPinHostActive = false;
    roomBadge.className = 'badge badge-warn';
    roomBadge.textContent = 'Offline';
    btnStartHosting.classList.remove('hidden');
    btnStopHosting.classList.add('hidden');
    webrtcDot.className = 'dot dot-inactive';
    webrtcStatusText.textContent = 'Idle';
    log('Guest PIN hosting stopped.', 'info');
  }

  function disconnectSignalingWs() {
    if (signalingWs) {
      try {
        if (signalingWs.readyState === WebSocket.OPEN) {
          sendWsMessage({ type: 'leave' });
        }
        signalingWs.close();
      } catch (e) {}
      signalingWs = null;
    }
  }

  function disconnectCurrentSession() {
    if (pc) {
      pc.close();
      pc = null;
    }
    disconnectSignalingWs();
    webrtcDot.className = 'dot dot-inactive';
    webrtcStatusText.textContent = 'Idle';
  }

  function sendWsMessage(obj) {
    if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify(obj));
    }
  }

  // -------------------------------------------------------------
  // Screen & Tab Stream Capture
  // -------------------------------------------------------------
  async function startScreenCapture() {
    log('Requesting screen/tab capture stream...', 'info');

    try {
      captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
          frameRate: { ideal: 60, max: 60 }
        },
        audio: false
      });

      localPreview.srcObject = captureStream;
      noStreamPlaceholder.classList.add('hidden');
      btnStartCapture.classList.add('hidden');
      btnStopCapture.classList.remove('hidden');

      captureDot.className = 'dot dot-active';
      captureStatusText.textContent = 'Active (Streaming)';
      captureBadge.className = 'badge badge-success';
      captureBadge.textContent = 'Streaming';

      log('Display capture stream active.', 'success');
      showToast('Screen stream acquired');

      const videoTrack = captureStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          log('Screen capture stopped from browser control.', 'warn');
          stopScreenCapture();
        };
      }

      if (pc) {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoTrack) {
          videoSender.replaceTrack(videoTrack);
          log('Hot-swapped WebRTC video track with new stream.', 'info');
        }
      }

    } catch (err) {
      log(`Capture error: ${err.message}`, 'error');
      showToast(`Capture failed: ${err.message}`, 'error');
      stopScreenCapture();
    }
  }

  function stopScreenCapture() {
    if (captureStream) {
      captureStream.getTracks().forEach(t => t.stop());
      captureStream = null;
    }

    localPreview.srcObject = null;
    noStreamPlaceholder.classList.remove('hidden');
    btnStartCapture.classList.remove('hidden');
    btnStopCapture.classList.add('hidden');

    captureDot.className = 'dot dot-inactive';
    captureStatusText.textContent = 'Inactive';
    captureBadge.className = 'badge badge-warn';
    captureBadge.textContent = 'No Stream';

    log('Display capture stopped.', 'info');
  }

  // -------------------------------------------------------------
  // WebRTC Peer Connection & DataChannel Setup
  // -------------------------------------------------------------
  function createPeerConnection() {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    pc = new RTCPeerConnection(config);

    if (captureStream) {
      captureStream.getTracks().forEach((track) => {
        pc.addTrack(track, captureStream);
        log(`Added ${track.kind} track to WebRTC connection.`, 'info');
      });
    } else {
      log('Notice: Screen capture not active yet. Click "Share Screen / Tab" to send video feed.', 'warn');
      showToast('Remember to click "Share Screen / Tab" for live video!', 'info');
    }

    try {
      dataChannel = pc.createDataChannel('input-control', { ordered: true });
      setupDataChannel(dataChannel);
    } catch (e) {
      log(`DataChannel error: ${e.message}`, 'error');
    }

    pc.ondatachannel = (event) => {
      log(`Remote viewer created DataChannel: ${event.channel.label}`, 'info');
      setupDataChannel(event.channel);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWsMessage({
          type: 'signal',
          data: {
            type: 'ice-candidate',
            candidate: event.candidate
          }
        });
      }
    };

    pc.onconnectionstatechange = () => {
      log(`WebRTC Connection State: ${pc.connectionState}`, 'info');
      if (pc.connectionState === 'connected') {
        webrtcDot.className = 'dot dot-active';
        webrtcStatusText.textContent = 'Connected (Live)';
        showToast('Remote viewer connected! Tab control live.');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        webrtcDot.className = 'dot dot-pending';
        webrtcStatusText.textContent = 'Awaiting Viewer';
        log('Remote viewer disconnected.', 'warn');
      }
    };
  }

  function setupDataChannel(channel) {
    dataChannel = channel;

    dataChannel.onopen = () => {
      log('Input Control DataChannel OPEN. Remote browser control ready!', 'success');
      showToast('Control DataChannel connected');
    };

    dataChannel.onclose = () => {
      log('Input Control DataChannel closed.', 'info');
    };

    dataChannel.onmessage = (event) => {
      handleRemoteViewerInput(event.data);
    };
  }

  async function initiateWebRtcOffer() {
    createPeerConnection();

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendWsMessage({
        type: 'signal',
        data: {
          type: 'offer',
          sdp: offer.sdp
        }
      });
      log('Generated and sent WebRTC Offer to Viewer.', 'info');
    } catch (err) {
      log(`Error creating WebRTC Offer: ${err.message}`, 'error');
    }
  }

  async function handleSignalData(data) {
    if (!pc) createPeerConnection();

    if (data.type === 'answer') {
      log('Received WebRTC Answer from Viewer.', 'info');
      await pc.setRemoteDescription(new RTCSessionDescription(data));

      while (pendingCandidates.length > 0) {
        const candidate = pendingCandidates.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    } else if (data.type === 'ice-candidate') {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        pendingCandidates.push(data.candidate);
      }
    }
  }

  // -------------------------------------------------------------
  // In-Tab DOM Input Injection Dispatcher
  // -------------------------------------------------------------
  function handleRemoteViewerInput(rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch (e) {
      return;
    }

    if (msg.type === 'navigate' && msg.url) {
      log(`[Navigation] Remote requested navigate to: ${msg.url}`, 'input');
      chrome.runtime.sendMessage({
        type: 'REMOTE_TAB_NAVIGATE',
        url: msg.url
      }, () => updateActiveTabDisplay());
      return;
    }

    if (msg.type === 'tab_action') {
      log(`[Tab Action] ${msg.action}`, 'input');
      chrome.runtime.sendMessage({
        type: 'REMOTE_TAB_ACTION',
        action: msg.action,
        url: msg.url
      }, () => updateActiveTabDisplay());
      return;
    }

    // Forward mouse, keyboard, and scroll events to content script
    chrome.runtime.sendMessage({
      type: 'DISPATCH_REMOTE_INPUT',
      payload: msg
    }, (res) => {
      if (res && res.title) {
        activeTabTitle.textContent = res.title;
      }
    });

    const now = performance.now();
    if (msg.type === 'mousemove') {
      if (now - lastLoggedInputTime > 2500) {
        log(`[Input] mousemove -> (${msg.x.toFixed(2)}, ${msg.y.toFixed(2)})`, 'input');
        lastLoggedInputTime = now;
      }
    } else if (msg.type === 'click') {
      log(`[Input] click at (${msg.x.toFixed(2)}, ${msg.y.toFixed(2)}) on active tab`, 'input');
    } else if (msg.type === 'keydown' || msg.type === 'keyup') {
      log(`[Input] ${msg.type}: ${msg.key || msg.code}`, 'input');
    } else if (msg.type === 'type') {
      log(`[Input] type text: "${msg.text}"`, 'input');
    } else if (msg.type === 'scroll') {
      log(`[Input] scroll dy: ${msg.dy}`, 'input');
    }
  }

  // -------------------------------------------------------------
  // Active Tab Monitor
  // -------------------------------------------------------------
  async function updateActiveTabDisplay() {
    try {
      chrome.runtime.sendMessage({ type: 'GET_TARGET_TAB' }, (res) => {
        if (chrome.runtime.lastError || !res) return;
        if (res.title) {
          activeTabTitle.textContent = res.title;
          activeTabUrl.textContent = res.url || '--';
          targetTabStatus.textContent = res.title ? res.title.slice(0, 25) + '...' : 'Active Web Tab';
        }
      });
    } catch (e) {}
  }

  // -------------------------------------------------------------
  // Event Listeners & UI Binding
  // -------------------------------------------------------------
  btnGeneratePin.addEventListener('click', generateRandomPin);
  btnCopyPin.addEventListener('click', () => {
    navigator.clipboard.writeText(currentPin);
    showToast(`PIN ${currentPin} copied!`);
  });

  btnCopyViewerUrl.addEventListener('click', () => {
    navigator.clipboard.writeText(viewerWebUrl.value);
    showToast('Viewer link copied to clipboard!');
  });

  btnStartCapture.addEventListener('click', startScreenCapture);
  btnStopCapture.addEventListener('click', stopScreenCapture);

  btnStartHosting.addEventListener('click', startPinHosting);
  btnStopHosting.addEventListener('click', stopPinHosting);

  btnClearConsole.addEventListener('click', () => {
    consoleLog.innerHTML = '';
  });

  toggleLocalPreview.addEventListener('change', () => {
    localPreview.style.display = toggleLocalPreview.checked ? 'block' : 'none';
  });

  toggleRemoteCursor.addEventListener('change', async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) {
      chrome.tabs.sendMessage(tab.id, {
        action: 'toggle_cursor',
        show: toggleRemoteCursor.checked
      }).catch(() => {});
    }
  });

  btnQuickOpen.addEventListener('click', () => {
    const url = quickUrlInput.value.trim();
    if (url) {
      chrome.tabs.create({ url }, () => {
        updateActiveTabDisplay();
      });
    }
  });

  // URL normalization on blur & change
  signalingUrlInput.addEventListener('change', () => {
    const normalized = normalizeWsUrl(signalingUrlInput.value);
    signalingUrlInput.value = normalized;
    chrome.storage.local.set({ pbr_signaling_url: normalized });
    updateViewerUrl();
    if (currentToken && activeMode === 'account') {
      log(`Relay URL updated to ${normalized}. Reconnecting...`, 'info');
      connectAccountHostSocket();
    }
  });

  signalingUrlInput.addEventListener('blur', () => {
    const normalized = normalizeWsUrl(signalingUrlInput.value);
    if (signalingUrlInput.value !== normalized) {
      signalingUrlInput.value = normalized;
      chrome.storage.local.set({ pbr_signaling_url: normalized });
      updateViewerUrl();
    }
  });

  chrome.tabs.onActivated.addListener(() => updateActiveTabDisplay());
  chrome.tabs.onUpdated.addListener(() => updateActiveTabDisplay());

  // Startup
  initPersistence();

})();
