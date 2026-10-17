// Pure Browser Remote - Web Viewer Client Logic
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

  // Connection State
  let ws = null;
  let pc = null;
  let dataChannel = null;
  let activePin = '';
  let pendingCandidates = [];
  let statsInterval = null;
  let toolbarHideTimer = null;

  // Auto-detect URL parameter ?pin=123456
  const urlParams = new URLSearchParams(window.location.search);
  const pinParam = urlParams.get('pin');
  if (pinParam) {
    pinInput.value = pinParam.trim();
  }

  // Auto-detect default signaling WebSocket URL based on current host
  const defaultProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultHost = window.location.host || 'localhost:8080';
  serverUrlInput.value = `${defaultProto}//${defaultHost}`;

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

  // Calculate normalized coordinate [0.0, 1.0] accounting for letterboxing/pillarboxing
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
      // Pillarbox (black bars left and right)
      renderWidth = rect.height * videoAspect;
      offsetX = (rect.width - renderWidth) / 2;
    } else {
      // Letterbox (black bars top and bottom)
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

  function sendData(payload) {
    if (dataChannel && dataChannel.readyState === 'open') {
      try {
        dataChannel.send(JSON.stringify(payload));
      } catch (err) {
        console.warn('[Viewer] DataChannel send error:', err);
      }
    }
  }

  function showClickMarker(clientX, clientY) {
    virtualClickMarker.classList.remove('hidden');
    virtualClickMarker.style.left = `${clientX}px`;
    virtualClickMarker.style.top = `${clientY}px`;
    virtualClickMarker.style.transform = 'translate(-50%, -50%) scale(1.6)';
    virtualClickMarker.style.opacity = '1';

    setTimeout(() => {
      virtualClickMarker.style.transform = 'translate(-50%, -50%) scale(1)';
      virtualClickMarker.style.opacity = '0';
      setTimeout(() => virtualClickMarker.classList.add('hidden'), 200);
    }, 150);
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

    pc.ontrack = (event) => {
      console.log('[Viewer] Media stream track received:', event.track.kind);
      if (remoteVideo.srcObject !== event.streams[0]) {
        remoteVideo.srcObject = event.streams[0];
      }
      setStatus('connected');
      connectOverlay.classList.add('hidden');
      viewerToolbar.classList.remove('hidden');
      floatingScrollDock.classList.remove('hidden');
      startTelemetryStats();
      showToast('Live stream connected!');
    };

    pc.ondatachannel = (event) => {
      console.log('[Viewer] DataChannel received from Host:', event.channel.label);
      setupDataChannel(event.channel);
    };

    try {
      const dc = pc.createDataChannel('input-control', { ordered: true });
      setupDataChannel(dc);
    } catch (e) {
      // Ignored
    }

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
      if (pc.connectionState === 'connected') {
        setStatus('connected');
      } else if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setStatus('disconnected');
        showToast('Peer disconnected', 'error');
      }
    };
  }

  function setupDataChannel(channel) {
    dataChannel = channel;
    dataChannel.onopen = () => {
      console.log('[Viewer] DataChannel is OPEN.');
      showToast('Remote Tab Control Active');
    };
    dataChannel.onclose = () => {
      console.log('[Viewer] DataChannel closed.');
    };
  }

  function sendWsMessage(obj) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function connect() {
    clearAlert();
    const serverUrl = serverUrlInput.value.trim();
    const pin = pinInput.value.trim();

    if (!pin || pin.length < 4) {
      showAlert('Enter a valid 6-digit Host Room PIN.');
      return;
    }

    activePin = pin;
    btnConnect.disabled = true;
    btnConnect.querySelector('.btn-text').textContent = 'Connecting...';
    setStatus('connecting');

    try {
      ws = new WebSocket(serverUrl);
    } catch (err) {
      showAlert(`WebSocket Error: ${err.message}`);
      btnConnect.disabled = false;
      btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
      setStatus('disconnected');
      return;
    }

    ws.onopen = () => {
      console.log('[Viewer] Connected to signaling relay.');
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
          console.log('[Viewer] Room accepted. Initializing WebRTC...');
          createPeerConnection();
          break;

        case 'signal':
          await handleSignalData(data);
          break;

        case 'host-disconnected':
          showToast(message || 'Host disconnected.', 'error');
          disconnect();
          break;

        case 'error':
          showAlert(message || 'Signaling error.');
          btnConnect.disabled = false;
          btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
          setStatus('disconnected');
          if (ws) ws.close();
          break;

        default:
          break;
      }
    };

    ws.onerror = () => {
      showAlert('Could not connect to signaling server. Verify server is online.');
      btnConnect.disabled = false;
      btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
      setStatus('disconnected');
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

  function disconnect() {
    if (statsInterval) clearInterval(statsInterval);
    if (dataChannel) { dataChannel.close(); dataChannel = null; }
    if (pc) { pc.close(); pc = null; }
    if (ws) {
      if (ws.readyState === WebSocket.OPEN) sendWsMessage({ type: 'leave' });
      ws.close();
      ws = null;
    }

    remoteVideo.srcObject = null;
    connectOverlay.classList.remove('hidden');
    viewerToolbar.classList.add('hidden');
    floatingScrollDock.classList.add('hidden');
    btnConnect.disabled = false;
    btnConnect.querySelector('.btn-text').textContent = 'Connect to Host';
    setStatus('disconnected');
  }

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

  // Mouse & Touch Input Capture
  let isMoveThrottled = false;

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

  remoteVideo.addEventListener('wheel', (e) => {
    e.preventDefault();
    const coords = getNormalizedCoordinates(e.clientX, e.clientY) || { x: 0.5, y: 0.5 };
    sendData({ type: 'scroll', dx: e.deltaX, dy: e.deltaY, x: coords.x, y: coords.y });
  }, { passive: false });

  // Mobile Touch Gestures
  let lastTouchX = 0;
  let lastTouchY = 0;
  let touchStartTime = 0;

  remoteVideo.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      lastTouchX = touch.clientX;
      lastTouchY = touch.clientY;
      touchStartTime = Date.now();
    }
  }, { passive: true });

  remoteVideo.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) {
      const touch = e.touches[0];
      const coords = getNormalizedCoordinates(touch.clientX, touch.clientY);
      if (coords) {
        sendData({ type: 'mousemove', x: coords.x, y: coords.y });
      }
    } else if (e.touches.length === 2) {
      // Two-finger scroll
      const currentY = e.touches[0].clientY;
      const deltaY = (lastTouchY - currentY) * 2;
      lastTouchY = currentY;
      sendData({ type: 'scroll', dx: 0, dy: deltaY });
    }
  }, { passive: true });

  remoteVideo.addEventListener('touchend', (e) => {
    const duration = Date.now() - touchStartTime;
    if (duration < 300 && e.changedTouches.length === 1) {
      // Tap detected -> trigger click
      const touch = e.changedTouches[0];
      const coords = getNormalizedCoordinates(touch.clientX, touch.clientY);
      if (coords) {
        showClickMarker(touch.clientX, touch.clientY);
        sendData({ type: 'click', button: 'left', double: false, x: coords.x, y: coords.y });
      }
    }
  });

  // Keyboard Interception (when typing directly into session)
  window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!dataChannel || dataChannel.readyState !== 'open') return;

    // Suppress browser navigation shortcuts
    if (['Tab', 'F5'].includes(e.key) || (e.ctrlKey && !['c', 'v'].includes(e.key.toLowerCase()))) {
      e.preventDefault();
    }

    sendData({
      type: 'keydown',
      key: e.key,
      code: e.code,
      modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
    });
  });

  window.addEventListener('keyup', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (!dataChannel || dataChannel.readyState !== 'open') return;

    sendData({
      type: 'keyup',
      key: e.key,
      code: e.code,
      modifiers: { ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey }
    });
  });

  // Remote Browser Navigation Bar Handlers
  function triggerNavigation() {
    const url = remoteUrlInput.value.trim();
    if (!url) return;
    sendData({ type: 'navigate', url });
    showToast(`Navigating to ${url}...`);
  }

  btnNavigate.addEventListener('click', triggerNavigation);
  remoteUrlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') triggerNavigation();
  });

  btnReloadTab.addEventListener('click', () => {
    sendData({ type: 'tab_action', action: 'reload' });
    showToast('Reloaded remote tab');
  });

  btnScrollUp.addEventListener('click', () => {
    sendData({ type: 'scroll', dy: -280 });
  });

  btnScrollDown.addEventListener('click', () => {
    sendData({ type: 'scroll', dy: 280 });
  });

  dockScrollUp.addEventListener('click', (e) => {
    e.stopPropagation();
    sendData({ type: 'scroll', dy: -280 });
  });

  dockScrollDown.addEventListener('click', (e) => {
    e.stopPropagation();
    sendData({ type: 'scroll', dy: 280 });
  });

  btnScrollTop.addEventListener('click', () => {
    sendData({ type: 'scroll', dy: -6000 });
  });

  btnScrollBottom.addEventListener('click', () => {
    sendData({ type: 'scroll', dy: 6000 });
  });

  // Text Modal Handlers
  btnOpenTextModal.addEventListener('click', () => {
    textModal.classList.remove('hidden');
    remoteTextInput.focus();
  });

  btnCloseTextModal.addEventListener('click', () => {
    textModal.classList.add('hidden');
  });

  btnSendText.addEventListener('click', () => {
    const text = remoteTextInput.value;
    if (!text) return;
    sendData({ type: 'type', text });
    textModal.classList.add('hidden');
    remoteTextInput.value = '';
    showToast('Injected text into active page');
  });

  btnSendEnter.addEventListener('click', () => {
    sendData({ type: 'keydown', key: 'Enter', code: 'Enter' });
    setTimeout(() => {
      sendData({ type: 'keyup', key: 'Enter', code: 'Enter' });
    }, 50);
    showToast('Sent Enter key');
  });

  // Fullscreen & Autohide
  btnFullscreen.addEventListener('click', () => {
    if (!document.fullscreenElement) {
      viewportContainer.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  });

  viewportContainer.addEventListener('mousemove', () => {
    if (document.fullscreenElement) {
      viewerToolbar.classList.remove('autohide');
      clearTimeout(toolbarHideTimer);
      toolbarHideTimer = setTimeout(() => {
        viewerToolbar.classList.add('autohide');
      }, 2500);
    }
  });

  btnConnect.addEventListener('click', connect);
  pinInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') connect();
  });
  btnDisconnect.addEventListener('click', disconnect);

})();
