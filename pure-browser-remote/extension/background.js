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

// Check if a tab is a normal accessible web page (not internal chrome/extension page)
function isValidWebTab(tab) {
  if (!tab || !tab.id || !tab.url) return false;
  const url = tab.url.toLowerCase();
  return !url.startsWith('chrome://') &&
         !url.startsWith('edge://') &&
         !url.startsWith('chrome-extension://') &&
         !url.startsWith('devtools://') &&
         !url.startsWith('about:') &&
         !url.startsWith('view-source:');
}

// Intelligently find the active/target web tab to inject input into
async function resolveTargetWebTab() {
  // 1. Check active tab in last focused window (if it is a valid web tab)
  try {
    const focusedTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (focusedTabs.length > 0 && isValidWebTab(focusedTabs[0])) {
      return focusedTabs[0];
    }
  } catch (e) {}

  // 2. Check any active tab across all windows
  try {
    const activeTabs = await chrome.tabs.query({ active: true });
    for (const t of activeTabs) {
      if (isValidWebTab(t)) {
        return t;
      }
    }
  } catch (e) {}

  // 3. Fallback: Find any open web tab in any window
  try {
    const allTabs = await chrome.tabs.query({});
    for (const t of allTabs) {
      if (isValidWebTab(t)) {
        return t;
      }
    }
  } catch (e) {}

  return null;
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

  // Get active web tab info for Host UI display
  if (message.type === 'GET_TARGET_TAB') {
    (async () => {
      const tab = await resolveTargetWebTab();
      if (tab) {
        sendResponse({ tabId: tab.id, title: tab.title, url: tab.url });
      } else {
        sendResponse({ tabId: null, title: 'No web page open', url: 'Open a tab to begin' });
      }
    })();
    return true;
  }

  // Handle Tab navigation & management commands
  if (message.type === 'REMOTE_TAB_NAVIGATE') {
    (async () => {
      let targetTab = await resolveTargetWebTab();
      let targetUrl = message.url.trim();
      if (!/^https?:\/\//i.test(targetUrl)) {
        targetUrl = 'https://' + targetUrl;
      }

      if (targetTab && targetTab.id) {
        await chrome.tabs.update(targetTab.id, { url: targetUrl, active: true });
        sendResponse({ status: 'navigated', url: targetUrl, tabId: targetTab.id });
      } else {
        targetTab = await chrome.tabs.create({ url: targetUrl, active: true });
        sendResponse({ status: 'created', url: targetUrl, tabId: targetTab.id });
      }
    })();
    return true;
  }

  if (message.type === 'REMOTE_TAB_ACTION') {
    (async () => {
      let targetTab = await resolveTargetWebTab();
      if (message.action === 'new_tab') {
        let url = (message.url || 'https://www.google.com').trim();
        if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
        await chrome.tabs.create({ url, active: true });
      } else if (targetTab && targetTab.id) {
        if (message.action === 'reload') {
          await chrome.tabs.reload(targetTab.id);
        } else if (message.action === 'close_tab') {
          await chrome.tabs.remove(targetTab.id);
        }
      }
      sendResponse({ status: 'action_completed', action: message.action });
    })();
    return true;
  }

  // Forward remote DOM input event to active web tab
  if (message.type === 'DISPATCH_REMOTE_INPUT') {
    (async () => {
      let targetTab = await resolveTargetWebTab();
      if (!targetTab) {
        // Automatically create a web tab if user hasn't opened any web page yet
        targetTab = await chrome.tabs.create({ url: 'https://www.google.com', active: true });
        await new Promise(r => setTimeout(r, 600));
      }

      try {
        // Send directly to content.js in tab
        await chrome.tabs.sendMessage(targetTab.id, {
          action: 'simulate_input',
          ...message.payload
        });
        sendResponse({ status: 'delivered', tabId: targetTab.id, title: targetTab.title });
      } catch (err) {
        // If content script was not ready, inject dynamically and retry
        try {
          await chrome.scripting.executeScript({
            target: { tabId: targetTab.id },
            files: ['content.js']
          });
          await chrome.tabs.sendMessage(targetTab.id, {
            action: 'simulate_input',
            ...message.payload
          });
          sendResponse({ status: 'delivered_after_injection', tabId: targetTab.id, title: targetTab.title });
        } catch (injectErr) {
          sendResponse({ status: 'injection_failed', error: injectErr.message });
        }
      }
    })();
    return true;
  }
});
