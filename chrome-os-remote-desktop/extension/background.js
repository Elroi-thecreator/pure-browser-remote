// Chrome OS Remote Desktop Host - Background Service Worker (Manifest V3)

// Open or switch to the dedicated Host Controller tab on action icon click
chrome.action.onClicked.addListener(async (tab) => {
  const hostUrl = chrome.runtime.getURL('host.html');
  const matchingTabs = await chrome.tabs.query({ url: hostUrl });

  if (matchingTabs.length > 0) {
    const existingTab = matchingTabs[0];
    await chrome.tabs.update(existingTab.id, { active: true });
    await chrome.windows.update(existingTab.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: hostUrl });
  }
});

// Automatically open the Host Controller tab upon initial installation or reload
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
    const hostUrl = chrome.runtime.getURL('host.html');
    await chrome.tabs.create({ url: hostUrl });
  }
});
