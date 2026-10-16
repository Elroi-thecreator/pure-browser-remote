// Pure Browser Remote - Host Controller Logic
(function () {
  'use strict';

  // DOM Elements
  const signalingDot = document.getElementById('signalingDot');
  const signalingStatusText = document.getElementById('signalingStatusText');
  const captureDot = document.getElementById('captureDot');
  const captureStatusText = document.getElementById('captureStatusText');
  const webrtcDot = document.getElementById('webrtcDot');
  const webrtcStatusText = document.getElementById('webrtcStatusText');
  const targetTabStatus = document.getElementById('targetTabStatus');

  const signalingUrlInput = document.getElementById('signalingUrl');
  const pinDisplay = document.getElementById('pinDisplay');
  const btnGeneratePin = document.getElementById('btnGeneratePin');
  const btnCopyPin = document.getElementById('btnCopyPin');
  const btnStartHosting = document.getElementById('btnStartHosting');
  const btnStopHosting = document.getElementById('btnStopHosting');
  const roomBadge = document.getElementById('roomBadge');
  const viewerWebUrl = document.getElementById('viewerWebUrl');
  const btnCopyViewerUrl = document.getElementById('btnCopyViewerUrl');

  const localPreview = document.getElementById('localPreview');
  const noStreamPlaceholder = document.getElementById('noStreamPlaceholder');
  const captureBadge = document.getElementById('captureBadge');
  const btnStartCapture = document.getElementById('btnStartCapture');
  const btnStopCapture = document.getElementById('btnStopCapture');

  const activeTabTitle = document.getElementById('activeTabTitle');
  const activeTabUrl = document.getElementById('activeTabUrl');
  const toggleRemoteCursor = document.getElementById('toggleRemoteCursor');
  const toggleLocalPreview = document.getElementById('toggleLocalPreview');
  const quickUrlInput = document.getElementById('quickUrlInput');
  const btnQuickOpen = document.getElementById('btnQuickOpen');

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
  let isHosting = false;
  let pendingCandidates = [];
  let lastLoggedInputTime = 0;

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

  function generateRandomPin() {
    currentPin = Math.floor(100000 + Math.random() * 900000).toString();
    pinDisplay.textContent = currentPin;
    updateViewerUrl();
    log(`Generated new room PIN: ${currentPin}`, 'info');
  }

  function updateViewerUrl() {
    const rawUrl = signalingUrlInput.value.trim();
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

  // Active Tab Monitor
  async function updateActiveTabDisplay() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab) {
        activeTabTitle.textContent = tab.title || 'Untitled Tab';
        activeTabUrl.textContent = tab.url || 'No URL';
        targetTabStatus.textContent = tab.title ? tab.title.slice(0, 25) + '...' : 'Active Tab';
      } else {
        activeTabTitle.textContent = 'No active window tab found';
        activeTabUrl.textContent = '--';
      }
    } catch (e) {
      // Ignored
    }
  }

  // 1. Desktop & Screen Stream Capture
  async function startScreenCapture() {
    log('Requesting screen/tab capture stream...', 'info');

    try {
      // Use getDisplayMedia (or chrome.desktopCapture)
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

      // Hot-swap stream if peer is already connected
      if (pc) {
        const senders = pc.getSenders();
        const videoSender = senders.find(s => s.track && s.track.kind === 'video');
        if (videoSender && videoTrack) {
          videoSender.replaceTrack(videoTrack);
          log('Replaced WebRTC video track with new capture stream.', 'info');
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

  // 2. WebRTC Peer Connection & DataChannel Setup
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
    }

    // DataChannel for remote in-tab input commands
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

  // Forward incoming DataChannel event to active browser tab via background script
  function handleRemoteViewerInput(rawData) {
    let msg;
    try {
      msg = JSON.parse(rawData);
    } catch (e) {
      return;
    }

    // Handle remote tab navigation
    if (msg.type === 'navigate' && msg.url) {
      log(`[Navigation] Remote requested navigate to: ${msg.url}`, 'input');
      chrome.runtime.sendMessage({
        type: 'REMOTE_TAB_NAVIGATE',
        url: msg.url
      }, (res) => {
        updateActiveTabDisplay();
      });
      return;
    }

    // Handle remote tab actions (reload, new tab, etc.)
    if (msg.type === 'tab_action') {
      log(`[Tab Action] ${msg.action}`, 'input');
      chrome.runtime.sendMessage({
        type: 'REMOTE_TAB_ACTION',
        action: msg.action,
        url: msg.url
      }, (res) => {
        updateActiveTabDisplay();
      });
      return;
    }

    // Dispatch DOM event simulation to active tab
    chrome.runtime.sendMessage({
      type: 'DISPATCH_REMOTE_INPUT',
      payload: msg
    }, (res) => {
      if (res && res.title) {
        activeTabTitle.textContent = res.title;
      }
    });

    // Throttled logging
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
      log(`[Input] scroll deltaY: ${msg.dy}`, 'input');
    }
  }

  // 3. Signaling & Hosting
  function sendWsMessage(obj) {
    if (signalingWs && signalingWs.readyState === WebSocket.OPEN) {
      signalingWs.send(JSON.stringify(obj));
    }
  }

  function startHosting() {
    const url = signalingUrlInput.value.trim();
    if (!url) {
      showToast('Enter a valid Signaling WebSocket URL', 'error');
      return;
    }

    if (!currentPin) generateRandomPin();

    log(`Connecting to Cloud Signaling Relay: ${url}...`, 'info');

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
          isHosting = true;
          roomBadge.className = 'badge badge-success';
          roomBadge.textContent = 'Hosting Live';
          btnStartHosting.classList.add('hidden');
          btnStopHosting.classList.remove('hidden');
          webrtcDot.className = 'dot dot-pending';
          webrtcStatusText.textContent = `Awaiting Viewer (PIN: ${currentPin})`;
          log(`Hosting session active. Share PIN ${currentPin} with viewer.`, 'success');
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
      log('Signaling connection error.', 'error');
      signalingDot.className = 'dot dot-inactive';
      signalingStatusText.textContent = 'Error';
    };

    signalingWs.onclose = () => {
      log('Signaling connection closed.', 'info');
      signalingDot.className = 'dot dot-inactive';
      signalingStatusText.textContent = 'Disconnected';
      stopHosting(false);
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

    webrtcDot.className = 'dot dot-inactive';
    webrtcStatusText.textContent = 'Idle';
    log('Hosting session ended.', 'info');
  }

  // Event Listeners
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

  btnStartHosting.addEventListener('click', startHosting);
  btnStopHosting.addEventListener('click', () => stopHosting(true));

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

  // Save signaling URL when modified
  signalingUrlInput.addEventListener('input', () => {
    const val = signalingUrlInput.value.trim();
    if (val) {
      chrome.storage.local.set({ savedSignalingUrl: val });
      updateViewerUrl();
    }
  });

  // Track active tab changes
  chrome.tabs.onActivated.addListener(() => updateActiveTabDisplay());
  chrome.tabs.onUpdated.addListener(() => updateActiveTabDisplay());

  // Startup: Load saved URL, generate PIN, and monitor active tab
  chrome.storage.local.get(['savedSignalingUrl'], (res) => {
    if (res && res.savedSignalingUrl) {
      signalingUrlInput.value = res.savedSignalingUrl;
    }
    generateRandomPin();
    updateActiveTabDisplay();
  });

})();

