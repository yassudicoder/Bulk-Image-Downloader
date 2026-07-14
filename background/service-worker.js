/**
 * background/service-worker.js — classic MV3 service worker (NOT a module).
 *
 * Flow: toolbar click -> inject scanner into the active tab (activeTab grants temporary
 * access) -> receive the ScanResult from executeScript -> stash it in storage.session ->
 * open the results page as a new extension tab. The results page reads the stash directly,
 * so nothing depends on this worker staying alive.
 */
'use strict';
importScripts('../shared/constants.js', '../shared/util.js');

const { MSG, STORAGE } = self.BID.constants;
const { shortId } = self.BID.util;

// --- URL gatekeeping --------------------------------------------------------
const RESTRICTED_PREFIXES = [
  'chrome://', 'chrome-extension://', 'chrome-search://', 'chrome-untrusted://',
  'edge://', 'about:', 'view-source:', 'devtools://', 'moz-extension://', 'data:',
];
function isRestricted(url) {
  if (!url) return true;
  const u = url.toLowerCase();
  if (RESTRICTED_PREFIXES.some((p) => u.startsWith(p))) return true;
  if (u.startsWith('https://chrome.google.com/webstore')) return true;
  if (u.startsWith('https://chromewebstore.google.com')) return true;
  return false;
}

// --- Scan orchestration -----------------------------------------------------
async function injectAndScan(tabId, fullPage) {
  // 1) Define the scanner in the tab's isolated world.
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/scanner.js'],
  });
  // 2) Invoke it and receive the (awaited) ScanResult.
  const injection = await chrome.scripting.executeScript({
    target: { tabId },
    func: (opts) => self.__bidRunScan(opts),
    args: [{ fullPage: !!fullPage }],
  });
  const result = injection && injection[0] ? injection[0].result : null;
  if (!result) throw new Error('empty_injection_result');
  return result;
}

async function storeScan(result, sourceTabId) {
  const rawId = shortId();
  const scanId = rawId;
  const key = STORAGE.scanPrefix + rawId;
  const payload = Object.assign({}, result, { scanId, sourceTabId });
  await chrome.storage.session.set({ [key]: payload });
  return scanId;
}

function openResults(scanId) {
  const url = chrome.runtime.getURL('results/results.html') + '?scan=' + encodeURIComponent(scanId);
  return chrome.tabs.create({ url });
}

async function handleActionClick(tab) {
  if (!tab || tab.id == null) return;

  if (isRestricted(tab.url)) {
    const scanId = await storeScan(
      { ok: false, error: 'restricted', pageUrl: tab.url || '', candidates: [], scannedAt: Date.now() },
      tab.id,
    );
    await openResults(scanId);
    return;
  }

  try {
    const result = await injectAndScan(tab.id, false);
    const scanId = await storeScan(result, tab.id);
    await openResults(scanId);
  } catch (err) {
    // Injection can fail on hardened pages, file:// without file access, PDFs, etc.
    const scanId = await storeScan(
      {
        ok: false,
        error: 'failed',
        message: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
        pageUrl: tab.url || '',
        candidates: [],
        scannedAt: Date.now(),
      },
      tab.id,
    );
    await openResults(scanId);
  }
}

// --- Full-page rescan (requested from the results page) ---------------------
async function handleRescanFullPage(sourceTabId) {
  if (sourceTabId == null) return { ok: false, error: 'no_tab' };
  try {
    const result = await injectAndScan(sourceTabId, true);
    const scanId = await storeScan(result, sourceTabId);
    return { ok: true, scanId };
  } catch (err) {
    // Most likely: the source tab navigated away or was closed, dropping activeTab access.
    return { ok: false, error: 'rescan_failed', message: err && err.message ? String(err.message) : 'unknown' };
  }
}

// --- Wiring -----------------------------------------------------------------
chrome.action.onClicked.addListener((tab) => {
  handleActionClick(tab).catch((e) => console.error('[BID] action click failed', e));
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case MSG.OPEN_OPTIONS:
      chrome.runtime.openOptionsPage();
      sendResponse({ ok: true });
      return; // sync response

    case 'BID_RESCAN_FULLPAGE':
      handleRescanFullPage(msg.tabId).then(sendResponse);
      return true; // async response

    default:
      return; // ignore unknown messages
  }
});

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    try {
      await chrome.storage.local.set({
        [STORAGE.installMeta]: { version: self.BID.constants.EXT_VERSION, installedAt: Date.now() },
      });
    } catch (_) { /* ignore */ }
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') });
    } catch (_) { /* ignore */ }
  }
});
