// Pure Browser Remote - Web Viewer Client Logic
(function () {
  'use strict';

  // DOM Elements - Overlays, Tabs, & Modals
  const connectOverlay = document.getElementById('connectOverlay');
  const alertBox = document.getElementById('alertBox');
  const serverUrlInput = document.getElementById('serverUrlInput');
  const tabViewerAccount = document.getElementById('tabViewerAccount');
  const tabViewerPin = document.getElementById('tabViewerPin');

  // DOM Elements - Account Mode
  const viewerAuthSection = document.getElementById('viewerAuthSection');
  const viewerUsername = document.getElementById('viewerUsername');
  const viewerPassword = document.getElementById('viewerPassword');
  const btnViewerLogin = document.getElementById('btnViewerLogin');
  const btnViewerRegister = document.getElementById('btnViewerRegister');

  const viewerDashboardSection = document.getElementById('viewerDashboardSection');
  const loggedUsername = document.getElementById('loggedUsername');
  const btnViewerLogout = document.getElementById('btnViewerLogout');
  const btnRefreshDevices = document.getElementById('btnRefreshDevices');
  const devicesContainer = document.getElementById('devicesContainer');

  // DOM Elements - PIN Mode
  const viewerPinSection = document.getElementById('viewerPinSection');
  const pinInput = document.getElementById('pinInput');
  const btnConnectPin = document.getElementById('btnConnectPin');

  // DOM Elements - Viewer Toolbar & Controls
  const viewerToolbar = document.getElementById('viewerToolbar');
  const btnReturnDashboard = document.getElementById('btnReturnDashboard');
  const connectionBadge = document.getElementById('connectionBadge');
  const telemetryBadge = document.getElementById('telemetryBadge');
  const remoteVideo = document.getElementById('remoteVideo');
  const videoWrapper = document.getElementById('videoWrapper');
  const viewportContainer = document.getElementById('viewportContainer');
  const virtualClickMarker = document.getElementById('virtualClickMarker');

  // Navigation & Toolbar Elements
  const remoteUrlInput = document.getElementById('remoteUrlInput');
  const btnNavigate = document.getElementById('btnNavigate');
  const btnReloadTab = document.getElementById('btnReloadTab');
  const btnScrollUp = document.getElementById('btnScrollUp');
  const btnScrollDown = document.getElementById('btnScrollDown');
  const btnScrollTop = document.getElementById('btnScrollTop');
  const btnScrollBottom = document.getElementById('btnScrollBottom');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnDisconnect = document.getElementById('btnDisconnect');

  // Floating Scroll Quick-Dock (Mobile / Touch)
  const floatingScrollDock = document.getElementById('floatingScrollDock');
  const dockScrollUp = document.getElementById('dockScrollUp');
  const dockScrollDown = document.getElementById('dockScrollDown');

  // Text Modal Elements
  const btnOpenTextModal = document.getElementById('btnOpenTextModal');
  const textModal = document.getElementById('textModal');
  const btnCloseTextModal = document.getElementById('btnCloseTextModal');
  const remoteTextInput = document.getElementById('remoteTextInput');
  const btnSendText = document.getElementById('btnSendText');
  const btnSendEnter = document.getElementById('btnSendEnter');

  const toastContainer = document.getElementById('toastContainer');

  // Internal State
  let ws = null;
  let pc = null;
  let dataChannel = null;
  let activeMode = 'account'; // 'account' | 'pin'
  let authToken = localStorage.getItem('pbr_viewer_token') || null;
  let authUsername = localStorage.getItem('pbr_viewer_username') || null;
  let activeDeviceId = null;
  let activePin = '';
  let pendingCandidates = [];
  let statsInterval = null;
  let isMoveThrottled = false;

  // Auto-detect default signaling WebSocket URL based on current host
  const defaultProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultHost = window.location.host || 'localhost:8080';
  serverUrlInput.value = `${defaultProto}//${defaultHost}`;

  // Check URL parameters (e.g. ?pin=123456)
  const urlParams = new URLSearchParams(window.location.search);
  const pinParam = urlParams.get('pin');
  if (pinParam) {
    pinInput.value = pinParam.trim();
    switchMode('pin');
  }

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

  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.classList.remove('hidden');
  }

  function clearAlert() {
    alertBox.textContent = '';
    alertBox.classList.add('hidden');
  }

  function getHttpBaseUrl() {
    const raw = serverUrlInput.value.trim() || `${defaultProto}//${defaultHost}`;
    if (raw.startsWith('wss://')) {
      return raw.replace('wss://', 'https://');
    }
    if (raw.startsWith('ws://')) {
      return raw.replace('ws://', 'http://');
    }
    return raw;
  }

  function setStatus(status) {
    connectionBadge.className = 'badge';
    if (status === 'connected') {
      connectionBadge.classList.add('badge-connected');
      connectionBadge.textContent = 'Streaming';
    } else if (status === 'connecting') {
      connectionBadge.classList.add('badge-connecting');
      connectionBadge.textContent = 'Connecting...';
    } else {
      connectionBadge.classList.add('badge-disconnected');
      connectionBadge.textContent = 'Disconnected';
      telemetryBadge.textContent = '-- ms | -- fps';
    }
  }

  // -------------------------------------------------------------
  // Mode Tab Navigation
  // -------------------------------------------------------------
  function switchMode(mode) {
    activeMode = mode;
    clearAlert();
    if (mode === 'account') {
      tabViewerAccount.classList.add('active');
      tabViewerPin.classList.remove('active');
      viewerPinSection.classList.add('hidden');
      if (authToken) {
        viewerAuthSection.classList.add('hidden');
        viewerDashboardSection.classList.remove('hidden');
      } else {
        viewerAuthSection.classList.remove('hidden');
        viewerDashboardSection.classList.add('hidden');
      }
    } else {
      tabViewerPin.classList.add('active');
      tabViewerAccount.classList.remove('active');
      viewerAuthSection.classList.add('hidden');
      viewerDashboardSection.classList.add('hidden');
      viewerPinSection.classList.remove('hidden');
    }
  }

  tabViewerAccount.addEventListener('click', () => switchMode('account'));
  tabViewerPin.addEventListener('click', () => switchMode('pin'));

  // -------------------------------------------------------------
  // Account Mode: REST Authentication & WebSocket Dashboard
  // -------------------------------------------------------------
  async function performAccountAuth(action) {
    clearAlert();
    const username = viewerUsername.value.trim();
    const password = viewerPassword.value.trim();

    if (!username || username.length < 3) {
      showAlert('Username must be at least 3 characters.');
      return;
    }
    if (!password || password.length < 6) {
      showAlert('Password must be at least 6 characters.');
      return;
    }

    const endpoint = action === 'login' ? '/api/auth/login' : '/api/auth/register';
    const httpBase = getHttpBaseUrl();

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

      authToken = data.token;
      authUsername = data.username;
      localStorage.setItem('pbr_viewer_token', authToken);
      localStorage.setItem('pbr_viewer_username', authUsername);

      showToast(`Welcome @${authUsername}! Loading devices...`);
      initDashboardView();
    } catch (err) {
      showAlert(err.message);
    }
  }

  btnViewerLogin.addEventListener('click', () => performAccountAuth('login'));
  btnViewerRegister.addEventListener('click', () => performAccountAuth('register'));

  btnViewerLogout.addEventListener('click', () => {
    disconnectSession();
    authToken = null;
    authUsername = null;
    localStorage.removeItem('pbr_viewer_token');
    localStorage.removeItem('pbr_viewer_username');
    switchMode('account');
    showToast('Logged out of viewer account.');
  });

  btnRefreshDevices.addEventListener('click', () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      sendWsMessage({ type: 'auth-viewer', token: authToken });
      showToast('Refreshing device list...');
    } else {
      connectDashboardSocket();
    }
  });

  function initDashboardView() {
    loggedUsername.textContent = `@${authUsername}`;
    viewerAuthSection.classList.add('hidden');
    viewerDashboardSection.classList.remove('hidden');
    connectDashboardSocket();
  }

  function connectDashboardSocket() {
    const wsUrl = serverUrlInput.value.trim();
    if (!wsUrl || !authToken) return;

    if (ws && ws.readyState === WebSocket.OPEN) {
      sendWsMessage({ type: 'auth-viewer', token: authToken });
      return;
    }

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      showAlert(`Relay connection failed: ${err.message}`);
      return;
    }

    ws.onopen = () => {
      console.log('[Viewer] WebSocket connected to relay. Authenticating...');
      sendWsMessage({ type: 'auth-viewer', token: authToken });
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      const { type, data, devices, deviceName, message, code } = msg;

      switch (type) {
        case 'viewer-authenticated':
        case 'device-list-update':
          renderDeviceList(devices || []);
          break;

        case 'device-accepted':
          console.log(`[Viewer] Device accepted: ${deviceName}. Setting up WebRTC...`);
          showToast(`Connecting to ${deviceName}...`);
          createPeerConnection();
          connectOverlay.classList.add('hidden');
          viewerToolbar.classList.remove('hidden');
          floatingScrollDock.classList.remove('hidden');
          btnReturnDashboard.style.display = 'inline-flex';
          setStatus('connecting');
          break;

        case 'viewer-accepted':
          console.log('[Viewer] PIN Room accepted. Initializing WebRTC...');
          createPeerConnection();
          connectOverlay.classList.add('hidden');
          viewerToolbar.classList.remove('hidden');
          floatingScrollDock.classList.remove('hidden');
          btnReturnDashboard.style.display = 'none';
          setStatus('connecting');
          break;

        case 'signal':
          await handleSignalData(data);
          break;

        case 'host-disconnected':
          showToast(message || 'Host workstation disconnected.', 'error');
          returnToDashboard();
          break;

        case 'error':
          if (code === 'AUTH_FAILED') {
            btnViewerLogout.click();
            showAlert('Session expired. Please log in again.');
          } else {
            showAlert(message || 'Signaling error.');
            showToast(message, 'error');
          }
          break;

        default:
          break;
      }
    };

    ws.onerror = () => {
      console.warn('[Viewer] WebSocket connection error.');
    };

    ws.onclose = () => {
      console.log('[Viewer] WebSocket closed.');
    };
  }

  function renderDeviceList(deviceList) {
    devicesContainer.innerHTML = '';

    if (!deviceList || deviceList.length === 0) {
      devicesContainer.innerHTML = `
        <div class="empty-state">
          No devices registered yet under this account.<br>
          <small>Open the Pure Browser Remote Host extension on your work machine and log into this account to register it.</small>
        </div>
      `;
      return;
    }

    deviceList.forEach((dev) => {
      const card = document.createElement('div');
      card.className = `device-card ${dev.isOnline ? 'online' : 'offline'}`;

      const lastSeenStr = dev.lastSeen ? new Date(dev.lastSeen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--';

      card.innerHTML = `
        <div class="device-meta">
          <div class="device-title">
            <span>💻</span>
            <span>${escapeHtml(dev.deviceName)}</span>
            <span class="device-status-badge ${dev.isOnline ? 'device-status-online' : 'device-status-offline'}">
              ${dev.isOnline ? '● Online' : '○ Offline'}
            </span>
          </div>
          <div class="device-subtitle">ID: ${escapeHtml(dev.deviceId)} • Last active: ${lastSeenStr}</div>
        </div>
        <div>
          ${dev.isOnline
            ? `<button class="btn btn-primary btn-sm btn-connect-dev" data-id="${escapeHtml(dev.deviceId)}" data-name="${escapeHtml(dev.deviceName)}">Connect 🚀</button>`
            : `<button class="btn btn-secondary btn-sm" disabled style="opacity:0.5;">Offline</button>`
          }
        </div>
      `;

      devicesContainer.appendChild(card);
    });

    // Attach Connect click listeners
    devicesContainer.querySelectorAll('.btn-connect-dev').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.getAttribute('data-id');
        const name = e.currentTarget.getAttribute('data-name');
        connectToDevice(id, name);
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>"']/g, (m) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[m]);
  }

  function connectToDevice(deviceId, deviceName) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connectDashboardSocket();
    }
    activeDeviceId = deviceId;
    console.log(`[Viewer] Requesting connection to device '${deviceName}' (${deviceId})...`);
    sendWsMessage({
      type: 'connect-device',
      deviceId: deviceId
    });
  }

  // -------------------------------------------------------------
  // Guest PIN Mode Logic
  // -------------------------------------------------------------
  btnConnectPin.addEventListener('click', () => {
    clearAlert();
    const pin = pinInput.value.trim();
    if (!pin || pin.length < 4) {
      showAlert('Enter a valid 6-digit Host Room PIN.');
      return;
    }

    activePin = pin;
    btnConnectPin.disabled = true;
    btnConnectPin.querySelector('.btn-text').textContent = 'Connecting...';
    setStatus('connecting');

    const wsUrl = serverUrlInput.value.trim();
    if (ws) {
      try { ws.close(); } catch (e) {}
      ws = null;
    }

    try {
      ws = new WebSocket(wsUrl);
    } catch (err) {
      showAlert(`WebSocket Error: ${err.message}`);
      btnConnectPin.disabled = false;
      btnConnectPin.querySelector('.btn-text').textContent = 'Connect to Host via PIN';
      setStatus('disconnected');
      return;
    }

    ws.onopen = () => {
      console.log('[Viewer] Connected to signaling relay via PIN.');
      sendWsMessage({
        type: 'join-viewer',
        pin: activePin
      });
    };

    ws.onmessage = async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      const { type, data, message } = msg;

      switch (type) {
        case 'viewer-accepted':
          createPeerConnection();
          connectOverlay.classList.add('hidden');
          viewerToolbar.classList.remove('hidden');
          floatingScrollDock.classList.remove('hidden');
          btnReturnDashboard.style.display = 'none';
          setStatus('connecting');
          break;

        case 'signal':
          await handleSignalData(data);
          break;

        case 'host-disconnected':
          showToast(message || 'Host disconnected.', 'error');
          disconnectSession();
          break;

        case 'error':
          showAlert(message || 'Signaling error.');
          btnConnectPin.disabled = false;
          btnConnectPin.querySelector('.btn-text').textContent = 'Connect to Host via PIN';
          setStatus('disconnected');
          if (ws) ws.close();
          break;

        default:
          break;
      }
    };

    ws.onerror = () => {
      showAlert('Could not connect to signaling server. Verify relay is online.');
      btnConnectPin.disabled = false;
      btnConnectPin.querySelector('.btn-text').textContent = 'Connect to Host via PIN';
      setStatus('disconnected');
    };
  });

  // -------------------------------------------------------------
  // WebRTC Peer Connection & Media Handling
  // -------------------------------------------------------------
  function createPeerConnection() {
    if (pc) {
      pc.close();
      pc = null;
    }

    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    pc = new RTCPeerConnection(config);

    pc.ontrack = (event) => {
      console.log('[Viewer] Incoming WebRTC media track received:', event.track.kind);
      if (event.streams && event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
        setStatus('connected');
        startTelemetryStats();
        showToast('Screen stream connected!');
      }
    };

    pc.ondatachannel = (event) => {
      console.log('[Viewer] Host opened DataChannel:', event.channel.label);
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
      console.log(`[Viewer] PeerConnection State: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setStatus('disconnected');
      }
    };
  }

  function setupDataChannel(channel) {
    dataChannel = channel;

    dataChannel.onopen = () => {
      console.log('[Viewer] DataChannel OPEN! Ready to send input commands.');
      showToast('Remote control input ready');
    };

    dataChannel.onclose = () => {
      console.log('[Viewer] DataChannel closed.');
    };
  }

  async function handleSignalData(data) {
    if (!pc) createPeerConnection();

    if (data.type === 'offer') {
      console.log('[Viewer] Received WebRTC Offer from Host');
      await pc.setRemoteDescription(new RTCSessionDescription(data));

      while (pendingCandidates.length > 0) {
        const candidate = pendingCandidates.shift();
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendWsMessage({
        type: 'signal',
        data: {
          type: 'answer',
          sdp: answer.sdp
        }
      });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data));
    } else if (data.type === 'ice-candidate') {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        pendingCandidates.push(data.candidate);
      }
    }
  }

  function sendWsMessage(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function sendData(payload) {
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify(payload));
      } catch (e) {
        console.warn('Failed to send payload over dataChannel:', e);
      }
    }
  }

  // -------------------------------------------------------------
  // Session Teardown & Dashboard Return
  // -------------------------------------------------------------
  function returnToDashboard() {
    if (statsInterval) clearInterval(statsInterval);
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (pc) { pc.close(); pc = null; }

    remoteVideo.srcObject = null;
    viewerToolbar.classList.add('hidden');
    floatingScrollDock.classList.add('hidden');
    connectOverlay.classList.remove('hidden');

    if (activeMode === 'account' && authToken) {
      // Inform relay to reset role to viewer-dashboard without closing socket
      sendWsMessage({ type: 'leave' });
      initDashboardView();
    } else {
      disconnectSession();
    }
  }

  function disconnectSession() {
    if (statsInterval) clearInterval(statsInterval);
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (pc) { pc.close(); pc = null; }
    if (ws) {
      try {
        if (ws.readyState === WebSocket.OPEN) sendWsMessage({ type: 'leave' });
        ws.close();
      } catch (e) {}
      ws = null;
    }

    remoteVideo.srcObject = null;
    connectOverlay.classList.remove('hidden');
    viewerToolbar.classList.add('hidden');
    floatingScrollDock.classList.add('hidden');
    btnConnectPin.disabled = false;
    btnConnectPin.querySelector('.btn-text').textContent = 'Connect to Host via PIN';
    setStatus('disconnected');
  }

  btnReturnDashboard.addEventListener('click', returnToDashboard);
  btnDisconnect.addEventListener('click', returnToDashboard);

  // -------------------------------------------------------------
  // Telemetry & Latency Monitoring
  // -------------------------------------------------------------
  function startTelemetryStats() {
    if (statsInterval) clearInterval(statsInterval);

    statsInterval = setInterval(async () => {
      if (!pc || pc.connectionState !== 'connected') return;

      try {
        const stats = await pc.getStats();
        let rtt = null;
        let fps = 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          } else if (report.type === 'inbound-rtp' && report.kind === 'video' && report.framesPerSecond !== undefined) {
            fps = Math.round(report.framesPerSecond);
          }
        });

        const rttStr = rtt !== null ? `${rtt}ms` : '--ms';
        const fpsStr = fps > 0 ? `${fps}fps` : '--fps';
        telemetryBadge.textContent = `${rttStr} | ${fpsStr}`;
      } catch (e) {}
    }, 1000);
  }

  // -------------------------------------------------------------
  // Input Normalization & Click Marker
  // -------------------------------------------------------------
  function getNormalizedCoordinates(clientX, clientY) {
    if (!remoteVideo.videoWidth || !remoteVideo.videoHeight) return null;

    const rect = remoteVideo.getBoundingClientRect();
    const videoWidth = remoteVideo.videoWidth;
    const videoHeight = remoteVideo.videoHeight;

    const videoAspect = videoWidth / videoHeight;
    const containerAspect = rect.width / rect.height;

    let renderWidth = rect.width;
    let renderHeight = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (containerAspect > videoAspect) {
      renderWidth = rect.height * videoAspect;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      renderHeight = rect.width / videoAspect;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const relX = clientX - rect.left;
    const relY = clientY - rect.top;

    if (relX < offsetX || relX > offsetX + renderWidth ||
        relY < offsetY || relY > offsetY + renderHeight) {
      return null;
    }

    const normX = (relX - offsetX) / renderWidth;
    const normY = (relY - offsetY) / renderHeight;

    return {
      x: Math.max(0, Math.min(1, normX)),
      y: Math.max(0, Math.min(1, normY))
    };
  }

  function showClickMarker(clientX, clientY) {
    virtualClickMarker.style.left = `${clientX}px`;
    virtualClickMarker.style.top = `${clientY}px`;
    virtualClickMarker.classList.remove('hidden');
    virtualClickMarker.style.transform = 'translate(-50%, -50%) scale(1.6)';
    virtualClickMarker.style.opacity = '1';

    setTimeout(() => {
      virtualClickMarker.style.transform = 'translate(-50%, -50%) scale(0.6)';
      virtualClickMarker.style.opacity = '0';
      setTimeout(() => virtualClickMarker.classList.add('hidden'), 250);
    }, 120);
  }

  // Mouse & Touch Listeners
  remoteVideo.addEventListener('mousemove', (e) => {
    if (isMoveThrottled) return;
    isMoveThrottled = true;

    requestAnimationFrame(() => {
      isMoveThrottled = false;
      const coords = getNormalizedCoordinates(e.clientX, e.clientY);
      if (!coords) return;
      sendData({ type: 'mousemove', x: coords.x, y: coords.y });
    });
  });

  remoteVideo.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e.clientX, e.clientY);
    if (!coords) return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendData({ type: 'mousedown', button, x: coords.x, y: coords.y });
  });

  window.addEventListener('mouseup', (e) => {
    const coords = getNormalizedCoordinates(e.clientX, e.clientY) || { x: 0.5, y: 0.5 };
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendData({ type: 'mouseup', button, x: coords.x, y: coords.y });
  });

  remoteVideo.addEventListener('click', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e.clientX, e.clientY);
    if (!coords) return;
    showClickMarker(e.clientX, e.clientY);
    sendData({ type: 'click', button: 'left', double: false, x: coords.x, y: coords.y });
  });

  remoteVideo.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e.clientX, e.clientY);
    if (!coords) return;
    sendData({ type: 'click', button: 'left', double: true, x: coords.x, y: coords.y });
  });

  remoteVideo.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e.clientX, e.clientY);
    if (!coords) return;
    sendData({ type: 'click', button: 'right', double: false, x: coords.x, y: coords.y });
  });

  // Touch Emulation for Mobile
  let touchStartTime = 0;
  remoteVideo.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      touchStartTime = Date.now();
      const t = e.touches[0];
      const coords = getNormalizedCoordinates(t.clientX, t.clientY);
      if (coords) {
        sendData({ type: 'mousemove', x: coords.x, y: coords.y });
      }
    }
  }, { passive: true });

  remoteVideo.addEventListener('touchend', (e) => {
    const duration = Date.now() - touchStartTime;
    if (e.changedTouches.length === 1 && duration < 350) {
      const t = e.changedTouches[0];
      const coords = getNormalizedCoordinates(t.clientX, t.clientY);
      if (coords) {
        showClickMarker(t.clientX, t.clientY);
        sendData({ type: 'click', button: 'left', double: false, x: coords.x, y: coords.y });
      }
    }
  });

  // Wheel Scroll Event
  remoteVideo.addEventListener('wheel', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e.clientX, e.clientY) || { x: 0.5, y: 0.5 };
    sendData({
      type: 'scroll',
      dx: e.deltaX,
      dy: e.deltaY,
      x: coords.x,
      y: coords.y
    });
  }, { passive: false });

  // Dedicated Remote Scroll Toolbar Buttons
  btnScrollUp.addEventListener('click', () => {
    sendData({ type: 'scroll', dx: 0, dy: -300, x: 0.5, y: 0.5 });
  });
  btnScrollDown.addEventListener('click', () => {
    sendData({ type: 'scroll', dx: 0, dy: 300, x: 0.5, y: 0.5 });
  });
  btnScrollTop.addEventListener('click', () => {
    sendData({ type: 'scroll_top' });
  });
  btnScrollBottom.addEventListener('click', () => {
    sendData({ type: 'scroll_bottom' });
  });

  // Floating On-Screen Scroll Quick-Dock (Mobile / Touch)
  dockScrollUp.addEventListener('click', (e) => {
    e.stopPropagation();
    sendData({ type: 'scroll', dx: 0, dy: -350, x: 0.5, y: 0.5 });
  });
  dockScrollDown.addEventListener('click', (e) => {
    e.stopPropagation();
    sendData({ type: 'scroll', dx: 0, dy: 350, x: 0.5, y: 0.5 });
  });

  // Keyboard Shortcuts (Arrow keys & Page navigation)
  window.addEventListener('keydown', (e) => {
    if (document.activeElement === remoteUrlInput || document.activeElement === remoteTextInput) {
      return;
    }

    if (e.key === 'ArrowUp') {
      sendData({ type: 'scroll', dx: 0, dy: -150, x: 0.5, y: 0.5 });
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      sendData({ type: 'scroll', dx: 0, dy: 150, x: 0.5, y: 0.5 });
      e.preventDefault();
    } else if (e.key === 'PageUp') {
      sendData({ type: 'scroll', dx: 0, dy: -500, x: 0.5, y: 0.5 });
      e.preventDefault();
    } else if (e.key === 'PageDown' || e.key === ' ') {
      sendData({ type: 'scroll', dx: 0, dy: 500, x: 0.5, y: 0.5 });
      e.preventDefault();
    } else if (e.key === 'Home') {
      sendData({ type: 'scroll_top' });
      e.preventDefault();
    } else if (e.key === 'End') {
      sendData({ type: 'scroll_bottom' });
      e.preventDefault();
    } else if (e.key === 'Escape') {
      textModal.classList.add('hidden');
    }
  });

  // Remote Browser Tab Navigation
  btnNavigate.addEventListener('click', () => {
    const url = remoteUrlInput.value.trim();
    if (url) {
      sendData({ type: 'navigate', url });
      showToast(`Navigating to ${url}...`);
    }
  });

  remoteUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      btnNavigate.click();
    }
  });

  btnReloadTab.addEventListener('click', () => {
    sendData({ type: 'tab_action', action: 'reload' });
    showToast('Reloading tab...');
  });

  // Type Text Modal
  btnOpenTextModal.addEventListener('click', () => {
    textModal.classList.remove('hidden');
    remoteTextInput.focus();
  });

  btnCloseTextModal.addEventListener('click', () => {
    textModal.classList.add('hidden');
  });

  btnSendText.addEventListener('click', () => {
    const text = remoteTextInput.value;
    if (text) {
      sendData({ type: 'type', text });
      showToast('Text injected to page');
      remoteTextInput.value = '';
      textModal.classList.add('hidden');
    }
  });

  btnSendEnter.addEventListener('click', () => {
    sendData({ type: 'keydown', key: 'Enter', code: 'Enter', keyCode: 13 });
    setTimeout(() => {
      sendData({ type: 'keyup', key: 'Enter', code: 'Enter', keyCode: 13 });
    }, 50);
    showToast('Enter key sent');
  });

  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      viewportContainer.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // -------------------------------------------------------------
  // Startup
  // -------------------------------------------------------------
  if (authToken && authUsername) {
    switchMode('account');
    initDashboardView();
  } else {
    switchMode('account');
  }

})();
