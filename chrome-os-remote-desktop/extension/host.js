// Chrome OS Remote Desktop - Host Controller Logic
(function () {
  'use strict';

  // DOM Elements
  const extIdDisplay = document.getElementById('extIdDisplay');
  const btnCopyExtId = document.getElementById('btnCopyExtId');

  // Status Elements
  const nativeStatusDot = document.getElementById('nativeStatusDot');
  const nativeStatusText = document.getElementById('nativeStatusText');
  const captureStatusDot = document.getElementById('captureStatusDot');
  const captureStatusText = document.getElementById('captureStatusText');
  const sessionStatusDot = document.getElementById('sessionStatusDot');
  const sessionStatusText = document.getElementById('sessionStatusText');
  const viewerStatusText = document.getElementById('viewerStatusText');

  // Native Host Card
  const nativeBadge = document.getElementById('nativeBadge');
  const osDisplayInfo = document.getElementById('osDisplayInfo');
  const ipcStatusInfo = document.getElementById('ipcStatusInfo');
  const btnConnectNative = document.getElementById('btnConnectNative');
  const btnToggleNativeHelp = document.getElementById('btnToggleNativeHelp');
  const nativeHelpBox = document.getElementById('nativeHelpBox');

  // Capture Card
  const captureBadge = document.getElementById('captureBadge');
  const localPreview = document.getElementById('localPreview');
  const noStreamPlaceholder = document.getElementById('noStreamPlaceholder');
  const fpsSelect = document.getElementById('fpsSelect');
  const btnStartCapture = document.getElementById('btnStartCapture');
  const btnStopCapture = document.getElementById('btnStopCapture');

  // Signaling & Room Card
  const roomBadge = document.getElementById('roomBadge');
  const signalingUrlInput = document.getElementById('signalingUrl');
  const pinDisplay = document.getElementById('pinDisplay');
  const btnGeneratePin = document.getElementById('btnGeneratePin');
  const btnCopyPin = document.getElementById('btnCopyPin');
  const btnStartHosting = document.getElementById('btnStartHosting');
  const btnStopHosting = document.getElementById('btnStopHosting');
  const viewerWebUrl = document.getElementById('viewerWebUrl');
  const btnCopyViewerUrl = document.getElementById('btnCopyViewerUrl');

  // Console
  const consoleLog = document.getElementById('consoleLog');
  const autoScrollCheck = document.getElementById('autoScrollCheck');
  const btnClearConsole = document.getElementById('btnClearConsole');
  const toastContainer = document.getElementById('toastContainer');

  // Runtime State
  const NATIVE_HOST_NAME = 'com.remote.oscontroller';
  let nativePort = null;
  let captureStream = null;
  let signalingWs = null;
  let pc = null;
  let dataChannel = null;
  let currentPin = '';
  let isHosting = false;
  let pendingCandidates = [];
  let lastLoggedInputTime = 0;

  // Initialize Extension ID Display
  const extensionId = chrome.runtime.id;
  extIdDisplay.textContent = extensionId;
  const helpIdSpans = document.querySelectorAll('.highlight-id');
  helpIdSpans.forEach(el => el.textContent = extensionId);

  // Helper: Toast Notifications
  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '⚠' : 'ℹ'}</span><span>${message}</span>`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  // Console Logger
  function log(message, type = 'info') {
    const timeStr = new Date().toLocaleTimeString();
    const entry = document.createElement('div');
    entry.className = `log-entry log-${type}`;
    entry.textContent = `[${timeStr}] ${message}`;
    consoleLog.appendChild(entry);

    // Limit log memory to 200 items
    while (consoleLog.children.length > 200) {
      consoleLog.removeChild(consoleLog.firstChild);
    }

    if (autoScrollCheck.checked) {
      consoleLog.scrollTop = consoleLog.scrollHeight;
    }
  }

  // Copy text to clipboard helper
  async function copyToClipboard(text, successMsg) {
    try {
      await navigator.clipboard.writeText(text);
      showToast(successMsg, 'success');
    } catch (err) {
      showToast('Failed to copy to clipboard', 'error');
    }
  }

  // Generate 6-digit random PIN
  function generateRandomPin() {
    const pin = Math.floor(100000 + Math.random() * 900000).toString();
    currentPin = pin;
    pinDisplay.textContent = pin;
    viewerWebUrl.value = `http://localhost:3000/?pin=${pin}`;
    log(`Generated new room PIN: ${pin}`, 'info');
  }

  // 1. Native Messaging Host Management
  function connectNativeHost() {
    if (nativePort) {
      try { nativePort.disconnect(); } catch (e) {}
      nativePort = null;
    }

    log(`Connecting to Native Messaging Host: ${NATIVE_HOST_NAME}...`, 'info');
    ipcStatusInfo.textContent = 'Connecting...';

    try {
      nativePort = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    } catch (err) {
      log(`Failed to initiate Native Messaging: ${err.message}`, 'error');
      updateNativeHostUI(false);
      return;
    }

    nativePort.onMessage.addListener((msg) => {
      if (msg.type === 'ready' || msg.type === 'screen_info') {
        const resolution = `${msg.width}x${msg.height}`;
        const osPlatform = msg.platform || 'OS';
        osDisplayInfo.textContent = `${resolution} (${osPlatform})`;
        ipcStatusInfo.textContent = 'Active (stdio IPC)';
        updateNativeHostUI(true);
        log(`Native Host confirmed online! Detected display: ${resolution}`, 'success');
        showToast(`Native Host connected (${resolution})`, 'success');
      }
    });

    nativePort.onDisconnect.addListener(() => {
      const lastError = chrome.runtime.lastError;
      const errorMsg = lastError ? lastError.message : 'Process terminated unexpectedly';
      log(`Native Host disconnected: ${errorMsg}`, 'error');
      updateNativeHostUI(false, errorMsg);
      nativePort = null;
    });

    // Request screen info immediately to confirm connection
    try {
      nativePort.postMessage({ type: 'get_screen_info' });
    } catch (e) {
      log(`Could not post initial ping to Native Host: ${e.message}`, 'warn');
    }
  }

  function updateNativeHostUI(isConnected, errorMsg = '') {
    if (isConnected) {
      nativeStatusDot.className = 'status-dot dot-active';
      nativeStatusText.textContent = 'Connected';
      nativeBadge.className = 'badge badge-success';
      nativeBadge.textContent = 'Online';
      btnConnectNative.textContent = '🔄 Reconnect Host';
      nativeHelpBox.classList.add('hidden');
    } else {
      nativeStatusDot.className = 'status-dot dot-inactive';
      nativeStatusText.textContent = 'Disconnected';
      nativeBadge.className = 'badge badge-danger';
      nativeBadge.textContent = 'Offline';
      ipcStatusInfo.textContent = errorMsg ? `Error: ${errorMsg}` : 'Disconnected';
      btnConnectNative.textContent = '🔌 Connect Native Host';
      nativeHelpBox.classList.remove('hidden');
    }
  }

  // 2. Desktop Capture (Screen Sharing)
  async function startScreenCapture() {
    const fps = parseInt(fpsSelect.value, 10) || 60;
    log(`Requesting Entire Screen Capture at ${fps} FPS...`, 'info');

    try {
      captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
          frameRate: { ideal: fps, max: fps },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      localPreview.srcObject = captureStream;
      noStreamPlaceholder.classList.add('hidden');
      btnStartCapture.classList.add('hidden');
      btnStopCapture.classList.remove('hidden');

      captureStatusDot.className = 'status-dot dot-active';
      captureStatusText.textContent = `Active (${fps} FPS)`;
      captureBadge.className = 'badge badge-success';
      captureBadge.textContent = 'Streaming';

      log('Screen capture stream acquired successfully.', 'success');
      showToast('Screen capture active', 'success');

      // Listen for when user stops screen share from native browser banner
      const videoTrack = captureStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          log('User stopped display capture from browser control.', 'warn');
          stopScreenCapture();
        };
      }

      // If already connected to peer, replace track
      if (pc) {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoTrack) {
          videoSender.replaceTrack(videoTrack);
          log('Live WebRTC video track hot-swapped to new screen stream.', 'info');
        }
      }

    } catch (err) {
      log(`Display Capture Error: ${err.message}`, 'error');
      showToast(`Capture Error: ${err.message}`, 'error');
      stopScreenCapture();
    }
  }

  function stopScreenCapture() {
    if (captureStream) {
      captureStream.getTracks().forEach(track => track.stop());
      captureStream = null;
    }

    localPreview.srcObject = null;
    noStreamPlaceholder.classList.remove('hidden');
    btnStartCapture.classList.remove('hidden');
    btnStopCapture.classList.add('hidden');

    captureStatusDot.className = 'status-dot dot-inactive';
    captureStatusText.textContent = 'Inactive';
    captureBadge.className = 'badge badge-warn';
    captureBadge.textContent = 'No Stream';

    log('Display capture stopped.', 'info');
  }

  // 3. WebRTC Peer Connection & DataChannel Setup
  function createPeerConnection() {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    pc = new RTCPeerConnection(config);

    // Add display capture video track
    if (captureStream) {
      captureStream.getTracks().forEach((track) => {
        pc.addTrack(track, captureStream);
        log(`Added ${track.kind} track to WebRTC PeerConnection`, 'info');
      });
    } else {
      log('Warning: Hosting started without active screen stream. Select a screen to stream video.', 'warn');
    }

    // Create DataChannel for OS Input Control
    try {
      dataChannel = pc.createDataChannel('input-control', { ordered: true });
      setupDataChannel(dataChannel);
    } catch (e) {
      log(`Error creating DataChannel: ${e.message}`, 'error');
    }

    // Also accept DataChannel from viewer
    pc.ondatachannel = (event) => {
      log(`Remote viewer created DataChannel: ${event.channel.label}`, 'info');
      setupDataChannel(event.channel);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendWsMessage({
          type: 'signal',
          target: 'viewer',
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
        sessionStatusDot.className = 'status-dot dot-active';
        sessionStatusText.textContent = 'Connected (Live)';
        viewerStatusText.textContent = 'Active Client';
        showToast('Viewer connected! OS Control is live.', 'success');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        sessionStatusDot.className = 'status-dot dot-pending';
        sessionStatusText.textContent = 'Awaiting Viewer';
        viewerStatusText.textContent = 'None Connected';
        log('Viewer disconnected from WebRTC session.', 'warn');
      }
    };
  }

  function setupDataChannel(channel) {
    dataChannel = channel;
    dataChannel.onopen = () => {
      log('Input Control DataChannel is OPEN and ready for commands.', 'success');
      // Send host screen info to viewer
      if (nativePort) {
        nativePort.postMessage({ type: 'get_screen_info' });
      }
    };

    dataChannel.onclose = () => {
      log('Input Control DataChannel closed.', 'info');
    };

    dataChannel.onerror = (err) => {
      log(`DataChannel error: ${err.message || 'unknown'}`, 'error');
    };

    dataChannel.onmessage = (event) => {
      handleViewerInputEvent(event.data);
    };
  }

  // Handle incoming remote viewer input event and dispatch to Native Host
  function handleViewerInputEvent(rawPayload) {
    let msg;
    try {
      msg = JSON.parse(rawPayload);
    } catch (e) {
      return;
    }

    // Forward event directly to Python native messaging host
    if (nativePort) {
      try {
        nativePort.postMessage(msg);
      } catch (err) {
        log(`Failed to post message to Native Host: ${err.message}`, 'error');
      }
    } else {
      log('Input event received but Native Host is disconnected!', 'warn');
    }

    // Throttled logging to keep UI snappy
    const now = performance.now();
    if (msg.type === 'mouse_move') {
      if (now - lastLoggedInputTime > 2000) {
        log(`[Input] mouse_move -> (${msg.x.toFixed(3)}, ${msg.y.toFixed(3)})`, 'input');
        lastLoggedInputTime = now;
      }
    } else if (msg.type === 'mouse_down' || msg.type === 'mouse_up' || msg.type === 'mouse_click') {
      log(`[Input] ${msg.type} (${msg.button || 'left'}) at (${msg.x ? msg.x.toFixed(3) : '-'}, ${msg.y ? msg.y.toFixed(3) : '-'})`, 'input');
    } else if (msg.type === 'key_down' || msg.type === 'key_up') {
      log(`[Input] ${msg.type}: ${msg.key || msg.code}`, 'input');
    } else if (msg.type === 'clipboard_paste') {
      log(`[Input] clipboard_paste (${msg.text.length} chars)`, 'input');
    } else if (msg.type === 'special_combo') {
      log(`[Input] special_combo: ${msg.combo}`, 'input');
    }
  }

  // 4. Signaling & Room Registration
  function sendWsMessage(obj) {
    if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify(obj));
    }
  }

  function startHosting() {
    const url = signalingUrlInput.value.trim();
    if (!url) {
      showToast('Please enter a valid Signaling URL', 'error');
      return;
    }

    if (!currentPin) {
      generateRandomPin();
    }

    log(`Connecting to Signaling Server: ${url}...`, 'info');

    try {
      signalingWs = new WebSocket(url);
    } catch (e) {
      log(`Signaling WebSocket creation failed: ${e.message}`, 'error');
      showToast('Invalid Signaling Server URL', 'error');
      return;
    }

    signalingWs.onopen = () => {
      log(`Connected to Signaling Server. Registering Room PIN: ${currentPin}`, 'success');
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
          isHosting = true;
          roomBadge.className = 'badge badge-success';
          roomBadge.textContent = 'Hosting Live';
          btnStartHosting.classList.add('hidden');
          btnStopHosting.classList.remove('hidden');
          sessionStatusDot.className = 'status-dot dot-pending';
          sessionStatusText.textContent = `Awaiting Viewer (PIN: ${currentPin})`;
          log(`Room PIN ${currentPin} registered. Ready for viewer.`, 'success');
          showToast(`Hosting on PIN: ${currentPin}`, 'success');
          break;

        case 'viewer-joined':
          log(`Viewer entered room PIN ${pin}! Initiating WebRTC handshake...`, 'success');
          await initiateWebRtcHandshake();
          break;

        case 'signal':
          await handleSignalData(data);
          break;

        case 'viewer-disconnected':
          log('Viewer disconnected from room.', 'warn');
          viewerStatusText.textContent = 'None Connected';
          sessionStatusDot.className = 'status-dot dot-pending';
          sessionStatusText.textContent = `Awaiting Viewer (PIN: ${currentPin})`;
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

    signalingWs.onerror = (err) => {
      log('Signaling WebSocket connection error.', 'error');
      showToast('Signaling connection error', 'error');
    };

    signalingWs.onclose = () => {
      log('Signaling WebSocket closed.', 'info');
      stopHosting(false);
    };
  }

  async function initiateWebRtcHandshake() {
    createPeerConnection();

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      sendWsMessage({
        type: 'signal',
        target: 'viewer',
        data: {
          type: 'offer',
          sdp: offer.sdp
        }
      });
      log('Created and sent WebRTC Offer to Viewer.', 'info');
    } catch (err) {
      log(`Error generating WebRTC Offer: ${err.message}`, 'error');
    }
  }

  async function handleSignalData(data) {
    if (!pc) createPeerConnection();

    if (data.type === 'answer') {
      log('Received WebRTC Answer from Viewer.', 'info');
      await pc.setRemoteDescription(new RTCSessionDescription(data));

      // Flush queued candidates
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

  function stopHosting(sendLeave = true) {
    isHosting = false;

    if (pc) {
      pc.close();
      pc = null;
    }

    if (signalingWs) {
      if (sendLeave && signalingWs.readyState === WebSocket.OPEN) {
        sendWsMessage({ type: 'leave' });
      }
      signalingWs.close();
      signalingWs = null;
    }

    roomBadge.className = 'badge badge-warn';
    roomBadge.textContent = 'Not Hosting';
    btnStartHosting.classList.remove('hidden');
    btnStopHosting.classList.add('hidden');

    sessionStatusDot.className = 'status-dot dot-inactive';
    sessionStatusText.textContent = 'Idle';
    viewerStatusText.textContent = 'None Connected';
    log('Hosting session terminated.', 'info');
  }

  // Event Listeners
  btnCopyExtId.addEventListener('click', () => {
    copyToClipboard(extensionId, 'Extension ID copied to clipboard!');
  });

  btnGeneratePin.addEventListener('click', generateRandomPin);

  btnCopyPin.addEventListener('click', () => {
    copyToClipboard(currentPin, `Room PIN ${currentPin} copied!`);
  });

  btnCopyViewerUrl.addEventListener('click', () => {
    copyToClipboard(viewerWebUrl.value, 'Direct Viewer link copied!');
  });

  btnConnectNative.addEventListener('click', connectNativeHost);

  btnToggleNativeHelp.addEventListener('click', () => {
    nativeHelpBox.classList.toggle('hidden');
  });

  btnStartCapture.addEventListener('click', startScreenCapture);
  btnStopCapture.addEventListener('click', stopScreenCapture);

  btnStartHosting.addEventListener('click', startHosting);
  btnStopHosting.addEventListener('click', () => stopHosting(true));

  btnClearConsole.addEventListener('click', () => {
    consoleLog.innerHTML = '';
  });

  // Initial Startup Actions
  generateRandomPin();
  connectNativeHost();

})();
