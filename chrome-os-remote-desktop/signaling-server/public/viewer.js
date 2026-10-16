// Chrome OS Remote Desktop - WebRTC Remote Viewer Client
(function () {
  'use strict';

  // DOM Elements
  const connectOverlay = document.getElementById('connectOverlay');
  const serverUrlInput = document.getElementById('serverUrlInput');
  const pinInput = document.getElementById('pinInput');
  const btnConnect = document.getElementById('btnConnect');
  const alertBox = document.getElementById('alertBox');

  const viewerToolbar = document.getElementById('viewerToolbar');
  const connectionBadge = document.getElementById('connectionBadge');
  const telemetryBadge = document.getElementById('telemetryBadge');
  const remoteVideo = document.getElementById('remoteVideo');
  const videoWrapper = document.getElementById('videoWrapper');
  const viewportContainer = document.getElementById('viewportContainer');
  const pointerLockNotice = document.getElementById('pointerLockNotice');

  // Toolbar Actions
  const btnToggleKeyboard = document.getElementById('btnToggleKeyboard');
  const keyboardStatusText = document.getElementById('keyboardStatusText');
  const btnPointerLock = document.getElementById('btnPointerLock');
  const btnFullscreen = document.getElementById('btnFullscreen');
  const btnDisconnect = document.getElementById('btnDisconnect');
  const btnWinKey = document.getElementById('btnWinKey');
  const btnAltTab = document.getElementById('btnAltTab');
  const btnCtrlAltDel = document.getElementById('btnCtrlAltDel');
  const btnEsc = document.getElementById('btnEsc');

  // Clipboard Dialog
  const btnClipboardModal = document.getElementById('btnClipboardModal');
  const clipboardModal = document.getElementById('clipboardModal');
  const btnCloseClipboardModal = document.getElementById('btnCloseClipboardModal');
  const clipboardTextInput = document.getElementById('clipboardTextInput');
  const btnInjectClipboard = document.getElementById('btnInjectClipboard');
  const btnInjectTyping = document.getElementById('btnInjectTyping');

  const toastContainer = document.getElementById('toastContainer');

  // Connection State
  let ws = null;
  let pc = null;
  let dataChannel = null;
  let activePin = '';
  let pendingCandidates = [];
  let isKeyboardInterceptionActive = true;
  let isPointerLocked = false;
  let statsInterval = null;
  let lastBytesReceived = 0;
  let lastTimestamp = 0;
  let lastFrameCount = 0;
  let toolbarHideTimeout = null;

  // Auto-detect default WebSocket URL
  const defaultWsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultWsHost = window.location.host || 'localhost:3000';
  serverUrlInput.value = `${defaultWsProtocol}//${defaultWsHost}/ws`;

  // Focus PIN field
  pinInput.focus();

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

  function showAlert(msg) {
    alertBox.textContent = msg;
    alertBox.classList.remove('hidden');
  }

  function clearAlert() {
    alertBox.textContent = '';
    alertBox.classList.add('hidden');
  }

  function setConnectionStatus(status) {
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
      telemetryBadge.textContent = '-- ms | -- fps | --x--';
    }
  }

  // Calculate pixel-perfect normalized coordinates [0.0, 1.0] accounting for letterboxing/pillarboxing
  function getNormalizedCoordinates(e) {
    if (!remoteVideo.videoWidth || !remoteVideo.videoHeight) {
      return null;
    }

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
      // Pillarbox (black bars left and right)
      renderWidth = rect.height * videoAspect;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      // Letterbox (black bars top and bottom)
      renderHeight = rect.width / videoAspect;
      offsetY = (rect.height - renderHeight) / 2;
    }

    const clientX = e.clientX - rect.left;
    const clientY = e.clientY - rect.top;

    // Check if click was in letterbox padding area
    if (clientX < offsetX || clientX > offsetX + renderWidth ||
        clientY < offsetY || clientY > offsetY + renderHeight) {
      return null;
    }

    const normX = (clientX - offsetX) / renderWidth;
    const normY = (clientY - offsetY) / renderHeight;

    return {
      x: Math.max(0, Math.min(1, normX)),
      y: Math.max(0, Math.min(1, normY))
    };
  }

  // Send input message safely via WebRTC DataChannel
  function sendInput(payload) {
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify(payload));
      } catch (err) {
        console.warn('[Viewer] DataChannel send error:', err);
      }
    }
  }

  // WebRTC Setup
  function createPeerConnection() {
    const config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    };

    pc = new RTCPeerConnection(config);

    // Setup incoming media stream
    pc.ontrack = (event) => {
      console.log('[Viewer] Incoming media track received:', event.track.kind);
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
      setConnectionStatus('connected');
      connectOverlay.classList.add('hidden');
      viewerToolbar.classList.remove('hidden');
      startTelemetryStats();
      showToast('Remote desktop stream established!', 'success');
    };

    // DataChannel created by Host
    pc.ondatachannel = (event) => {
      console.log('[Viewer] DataChannel received from Host:', event.channel.label);
      setupDataChannel(event.channel);
    };

    // Also proactively create DataChannel in case viewer initiates
    try {
      const dc = pc.createDataChannel('input-control', { ordered: true });
      setupDataChannel(dc);
    } catch (e) {
      console.log('[Viewer] Could not create local dataChannel, awaiting host channel.');
    }

    // ICE Candidate handler
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
      console.log('[Viewer] WebRTC Connection State:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        setConnectionStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setConnectionStatus('disconnected');
        showToast('WebRTC peer disconnected', 'error');
      }
    };
  }

  function setupDataChannel(channel) {
    dataChannel = channel;
    dataChannel.onopen = () => {
      console.log('[Viewer] DataChannel is now OPEN.');
      showToast('OS Input Control Channel Active', 'success');
    };
    dataChannel.onclose = () => {
      console.log('[Viewer] DataChannel closed.');
    };
    dataChannel.onerror = (err) => {
      console.error('[Viewer] DataChannel error:', err);
    };
    dataChannel.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'screen_info') {
          console.log('[Viewer] Host physical screen:', `${msg.width}x${msg.height} (${msg.platform})`);
        }
      } catch (e) {
        // Ignored
      }
    };
  }

  function sendWsMessage(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  // Connect to Signaling and Join Room
  function connect() {
    clearAlert();
    const serverUrl = serverUrlInput.value.trim();
    const pin = pinInput.value.trim();

    if (!pin || pin.length < 4) {
      showAlert('Please enter a valid Host Room PIN.');
      return;
    }

    activePin = pin;
    btnConnect.disabled = true;
    btnConnect.querySelector('.btn-text').textContent = 'Connecting...';
    btnConnect.querySelector('.btn-spinner').classList.remove('hidden');
    setConnectionStatus('connecting');

    try {
      ws = new WebSocket(serverUrl);
    } catch (err) {
      showAlert(`Invalid WebSocket URL: ${err.message}`);
      btnConnect.disabled = false;
      btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
      btnConnect.querySelector('.btn-spinner').classList.add('hidden');
      return;
    }

    ws.onopen = () => {
      console.log('[Viewer] Connected to signaling server');
      // Request to join room as viewer
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
        console.error('[Viewer] Bad signaling message:', event.data);
        return;
      }

      const { type, data, message } = msg;

      switch (type) {
        case 'viewer-accepted':
          console.log('[Viewer] Accepted into room PIN:', msg.pin);
          createPeerConnection();
          break;

        case 'signal':
          await handleSignalData(data);
          break;

        case 'host-disconnected':
          showToast(message || 'Host disconnected.', 'error');
          disconnectSession();
          break;

        case 'error':
          showAlert(message || 'An error occurred.');
          btnConnect.disabled = false;
          btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
          btnConnect.querySelector('.btn-spinner').classList.add('hidden');
          setConnectionStatus('disconnected');
          if (ws) ws.close();
          break;

        default:
          break;
      }
    };

    ws.onerror = (err) => {
      showAlert('Signaling connection error. Verify the server is running.');
      btnConnect.disabled = false;
      btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
      btnConnect.querySelector('.btn-spinner').classList.add('hidden');
      setConnectionStatus('disconnected');
    };

    ws.onclose = () => {
      console.log('[Viewer] Signaling connection closed.');
    };
  }

  // Handle incoming WebRTC signaling data
  async function handleSignalData(data) {
    if (!pc) createPeerConnection();

    if (data.type === 'offer') {
      console.log('[Viewer] Received WebRTC Offer from Host');
      await pc.setRemoteDescription(new RTCSessionDescription(data));

      // Flush queued candidates
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
      console.log('[Viewer] Sent WebRTC Answer to Host');

    } else if (data.type === 'answer') {
      console.log('[Viewer] Received WebRTC Answer');
      await pc.setRemoteDescription(new RTCSessionDescription(data));

    } else if (data.type === 'ice-candidate') {
      if (pc.remoteDescription && pc.remoteDescription.type) {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } else {
        pendingCandidates.push(data.candidate);
      }
    }
  }

  // Disconnect & Reset
  function disconnectSession() {
    if (statsInterval) {
      clearInterval(statsInterval);
      statsInterval = null;
    }

    if (dataChannel) {
      dataChannel.close();
      dataChannel = null;
    }

    if (pc) {
      pc.close();
      pc = null;
    }

    if (ws) {
      if (ws.readyState === WebSocket.OPEN) {
        sendWsMessage({ type: 'leave' });
      }
      ws.close();
      ws = null;
    }

    remoteVideo.srcObject = null;
    connectOverlay.classList.remove('hidden');
    viewerToolbar.classList.add('hidden');
    btnConnect.disabled = false;
    btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
    btnConnect.querySelector('.btn-spinner').classList.add('hidden');
    setConnectionStatus('disconnected');
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }

  // Telemetry Monitor (Stats API)
  function startTelemetryStats() {
    if (statsInterval) clearInterval(statsInterval);

    statsInterval = setInterval(async () => {
      if (!pc || pc.connectionState !== 'connected') return;

      try {
        const stats = await pc.getStats();
        let rtt = null;
        let fps = 0;
        let width = remoteVideo.videoWidth || 0;
        let height = remoteVideo.videoHeight || 0;

        stats.forEach((report) => {
          if (report.type === 'candidate-pair' && report.currentRoundTripTime !== undefined) {
            rtt = Math.round(report.currentRoundTripTime * 1000);
          } else if (report.type === 'inbound-rtp' && report.kind === 'video') {
            if (report.framesPerSecond !== undefined) {
              fps = Math.round(report.framesPerSecond);
            }
          }
        });

        const rttStr = rtt !== null ? `${rtt}ms` : '--ms';
        const fpsStr = fps > 0 ? `${fps}fps` : '--fps';
        const resStr = width > 0 ? `${width}x${height}` : '--x--';

        telemetryBadge.textContent = `${rttStr} | ${fpsStr} | ${resStr}`;
      } catch (e) {
        // Stats failed
      }
    }, 1000);
  }

  // Mouse Input Handling
  let isMouseDown = false;
  let mouseMoveThrottled = false;

  function buttonNameFromNumber(btnNum) {
    switch (btnNum) {
      case 0: return 'left';
      case 1: return 'middle';
      case 2: return 'right';
      default: return 'left';
    }
  }

  remoteVideo.addEventListener('mousemove', (e) => {
    if (mouseMoveThrottled) return;
    mouseMoveThrottled = true;

    requestAnimationFrame(() => {
      mouseMoveThrottled = false;
      const coords = getNormalizedCoordinates(e);
      if (!coords) return;

      sendInput({
        type: 'mouse_move',
        x: coords.x,
        y: coords.y
      });
    });
  });

  remoteVideo.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    isMouseDown = true;
    const button = buttonNameFromNumber(e.button);

    sendInput({
      type: 'mouse_down',
      button: button,
      x: coords.x,
      y: coords.y
    });
  });

  window.addEventListener('mouseup', (e) => {
    if (!isMouseDown) return;
    isMouseDown = false;

    const coords = getNormalizedCoordinates(e) || { x: 0.5, y: 0.5 };
    const button = buttonNameFromNumber(e.button);

    sendInput({
      type: 'mouse_up',
      button: button,
      x: coords.x,
      y: coords.y
    });
  });

  remoteVideo.addEventListener('contextmenu', (e) => {
    e.preventDefault(); // Suppress local browser context menu
  });

  remoteVideo.addEventListener('wheel', (e) => {
    e.preventDefault(); // Prevent local scrolling
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    sendInput({
      type: 'mouse_scroll',
      dx: e.deltaX,
      dy: e.deltaY,
      x: coords.x,
      y: coords.y
    });
  }, { passive: false });

  remoteVideo.addEventListener('dblclick', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e);
    if (!coords) return;

    sendInput({
      type: 'mouse_click',
      button: buttonNameFromNumber(e.button),
      double: true,
      x: coords.x,
      y: coords.y
    });
  });

  // Keyboard Interception
  window.addEventListener('keydown', (e) => {
    // Ignore keystrokes when typing in modals or input fields
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    if (!isKeyboardInterceptionActive || !dataChannel || dataChannel.readyState !== 'open') {
      return;
    }

    // Suppress default browser shortcuts (Ctrl+W, Ctrl+T, F5, Tab, Alt+Left, etc.)
    const blockedKeys = ['Tab', 'F5', 'F11', 'F12'];
    if (blockedKeys.includes(e.key) || (e.ctrlKey && !['c', 'v'].includes(e.key.toLowerCase()))) {
      e.preventDefault();
    }

    sendInput({
      type: 'key_down',
      key: e.key,
      code: e.code,
      modifiers: {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey
      }
    });
  });

  window.addEventListener('keyup', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
      return;
    }

    if (!isKeyboardInterceptionActive || !dataChannel || dataChannel.readyState !== 'open') {
      return;
    }

    sendInput({
      type: 'key_up',
      key: e.key,
      code: e.code,
      modifiers: {
        ctrl: e.ctrlKey,
        alt: e.altKey,
        shift: e.shiftKey,
        meta: e.metaKey
      }
    });
  });

  // Pointer Lock API (Optional relative mouse capture)
  btnPointerLock.addEventListener('click', () => {
    if (!isPointerLocked) {
      videoWrapper.requestPointerLock().catch((err) => {
        showToast('Pointer Lock failed: ' + err.message, 'error');
      });
    } else {
      document.exitPointerLock();
    }
  });

  document.addEventListener('pointerlockchange', () => {
    isPointerLocked = document.pointerLockElement === videoWrapper;
    if (isPointerLocked) {
      btnPointerLock.classList.add('active');
      btnPointerLock.textContent = '🎯 Locked';
      pointerLockNotice.classList.remove('hidden');
      setTimeout(() => pointerLockNotice.classList.add('hidden'), 3000);
    } else {
      btnPointerLock.classList.remove('active');
      btnPointerLock.textContent = '🎯 Lock Mouse';
      pointerLockNotice.classList.add('hidden');
    }
  });

  // Special OS Keys Toolbar Handlers
  btnWinKey.addEventListener('click', () => {
    sendInput({ type: 'special_combo', combo: 'win' });
    showToast('Sent Windows Key', 'info');
  });

  btnAltTab.addEventListener('click', () => {
    sendInput({ type: 'special_combo', combo: 'alt_tab' });
    showToast('Sent Alt+Tab', 'info');
  });

  btnCtrlAltDel.addEventListener('click', () => {
    sendInput({ type: 'special_combo', combo: 'ctrl_alt_del' });
    showToast('Sent Ctrl+Alt+Del', 'info');
  });

  btnEsc.addEventListener('click', () => {
    sendInput({ type: 'key_down', key: 'Escape', code: 'Escape', modifiers: {} });
    setTimeout(() => {
      sendInput({ type: 'key_up', key: 'Escape', code: 'Escape', modifiers: {} });
    }, 50);
  });

  btnToggleKeyboard.addEventListener('click', () => {
    isKeyboardInterceptionActive = !isKeyboardInterceptionActive;
    if (isKeyboardInterceptionActive) {
      btnToggleKeyboard.classList.add('active');
      keyboardStatusText.textContent = 'ON';
      showToast('Keyboard Interception Enabled', 'info');
    } else {
      btnToggleKeyboard.classList.remove('active');
      keyboardStatusText.textContent = 'OFF';
      showToast('Keyboard Interception Disabled', 'info');
    }
  });

  // Fullscreen Toggle
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      viewportContainer.requestFullscreen().catch((err) => {
        showToast('Fullscreen error: ' + err.message, 'error');
      });
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  // Autohide Toolbar in Fullscreen
  viewportContainer.addEventListener('mousemove', () => {
    if (document.fullscreenElement) {
      viewerToolbar.classList.remove('autohide');
      clearTimeout(toolbarHideTimeout);
      toolbarHideTimeout = setTimeout(() => {
        viewerToolbar.classList.add('autohide');
      }, 2500);
    }
  });

  // Clipboard / Text Injection Modal
  btnClipboardModal.addEventListener('click', () => {
    clipboardModal.classList.remove('hidden');
    clipboardTextInput.focus();
  });

  btnCloseClipboardModal.addEventListener('click', () => {
    clipboardModal.classList.add('hidden');
  });

  btnInjectClipboard.addEventListener('click', () => {
    const text = clipboardTextInput.value;
    if (!text) return;

    sendInput({
      type: 'clipboard_paste',
      text: text
    });

    clipboardModal.classList.add('hidden');
    clipboardTextInput.value = '';
    showToast('Injected text via OS clipboard!', 'success');
  });

  btnInjectTyping.addEventListener('click', () => {
    const text = clipboardTextInput.value;
    if (!text) return;

    sendInput({
      type: 'key_type',
      text: text
    });

    clipboardModal.classList.add('hidden');
    clipboardTextInput.value = '';
    showToast('Typing simulated on remote OS!', 'success');
  });

  // Buttons & Form Submit
  btnConnect.addEventListener('click', connect);
  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect();
  });

  btnDisconnect.addEventListener('click', () => {
    disconnectSession();
    showToast('Session terminated.', 'info');
  });

})();
