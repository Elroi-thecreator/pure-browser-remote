// Pure Browser Remote - Background Service Worker (Manifest V3)

// Open or switch to Host Control Panel on extension icon click
chrome.action.onClicked.addListener(async () => {
  const hostUrl = chrome.runtime.getURL('host.html');
  const tabs = await chrome.tabs.query({ url: hostUrl });

  if (tabs.length > 0) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    await chrome.windows.update(tabs[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: hostUrl });
  }
});

// Launch Host Panel on extension installation
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    const hostUrl = chrome.runtime.getURL('host.html');
    await chrome.tabs.create({ url: hostUrl });
  }
});

// Offscreen Document Lifecycle Manager
async function ensureOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (!existing) {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'WEB_RTC'],
      justification: 'WebRTC stream processing and media handling'
    });
  }
}

async function closeOffscreenDocument() {
  const existing = await chrome.offscreen.hasDocument();
  if (existing) {
    await chrome.offscreen.closeDocument();
  }
}

// Router for remote input and tab commands
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  // Handle Offscreen lifecycle requests
  if (message.type === 'ENSURE_OFFSCREEN') {
    ensureOffscreenDocument().then(() => sendResponse({ status: 'ok' }));
    return true;
  }
  if (message.type === 'CLOSE_OFFSCREEN') {
    closeOffscreenDocument().then(() => sendResponse({ status: 'ok' }));
    return true;
  }

  // Handle Tab navigation & management commands
  if (message.type === 'REMOTE_TAB_NAVIGATE') {
    (async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (activeTab && activeTab.id) {
        let targetUrl = message.url.trim();
        if (!/^https?:\/\//i.test(targetUrl)) {
          targetUrl = 'https://' + targetUrl;
        }
        await chrome.tabs.update(activeTab.id, { url: targetUrl });
        sendResponse({ status: 'navigated', url: targetUrl });
      }
    })();
    return true;
  }

  if (message.type === 'REMOTE_TAB_ACTION') {
    (async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!activeTab || !activeTab.id) return;

      if (message.action === 'reload') {
        await chrome.tabs.reload(activeTab.id);
      } else if (message.action === 'new_tab') {
        await chrome.tabs.create({ url: message.url || 'https://www.google.com' });
      } else if (message.action === 'close_tab') {
        await chrome.tabs.remove(activeTab.id);
      }
      sendResponse({ status: 'action_completed', action: message.action });
    })();
    return true;
  }

  // Forward remote DOM input event to active web tab
  if (message.type === 'DISPATCH_REMOTE_INPUT') {
    (async () => {
      const [activeTab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!activeTab || !activeTab.id || !activeTab.url) {
        sendResponse({ status: 'no_active_tab' });
        return;
      }

      // Skip chrome:// and extension:// URLs where content scripts cannot execute
      if (activeTab.url.startsWith('chrome://') || activeTab.url.startsWith('edge://') || activeTab.url.startsWith('chrome-extension://')) {
        sendResponse({ status: 'skipped_internal_page', url: activeTab.url });
        return;
      }

      try {
        // Send directly to content.js in tab
        await chrome.tabs.sendMessage(activeTab.id, {
          action: 'simulate_input',
          ...message.payload
        });
        sendResponse({ status: 'delivered', tabId: activeTab.id, title: activeTab.title });
      } catch (err) {
        // If content script was not ready, inject dynamically and retry
        try {
          await chrome.scripting.executeScript({
            target: { tabId: activeTab.id },
            files: ['content.js']
          });
          await chrome.tabs.sendMessage(activeTab.id, {
            action: 'simulate_input',
            ...message.payload
          });
          sendResponse({ status: 'delivered_after_injection', tabId: activeTab.id });
        } catch (injectErr) {
          sendResponse({ status: 'injection_failed', error: injectErr.message });
        }
      }
    })();
    return true;
  }
});
