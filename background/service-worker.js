/**
 * background/service-worker.js — classic MV3 service worker (NOT a module).
 *
 * Flow: the toolbar click opens the popup -> the popup asks this worker (POPUP_SCAN) to
 * inject the scanner into the active tab (activeTab grants temporary access) -> receive the
 * ScanResult from executeScript -> stash it in storage.session -> return a summary to the
 * popup. The popup opens the results page (?scan=<id>), which reads the stash directly, so
 * nothing depends on this worker staying alive.
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

// Scan the active tab (identified by the popup) and stash the ScanResult. Returns a compact
// summary the popup renders; the popup opens the results tab itself on "View Results".
async function scanActiveTabAndStore(tabId, url, fullPage) {
  if (tabId == null) return { ok: false, error: 'no_tab' };

  if (isRestricted(url)) {
    const scanId = await storeScan(
      { ok: false, error: 'restricted', pageUrl: url || '', candidates: [], scannedAt: Date.now() },
      tabId,
    );
    return { ok: false, restricted: true, scanId };
  }

  try {
    const result = await injectAndScan(tabId, fullPage);
    const scanId = await storeScan(result, tabId);
    return {
      ok: true,
      scanId,
      count: (result.candidates || []).length,
      pageUrl: result.pageUrl || url || '',
      fullPage: !!fullPage,
    };
  } catch (err) {
    // Injection can fail on hardened pages, file:// without file access, PDFs, etc.
    const scanId = await storeScan(
      {
        ok: false,
        error: 'failed',
        message: err && err.message ? String(err.message).slice(0, 300) : 'unknown',
        pageUrl: url || '',
        candidates: [],
        scannedAt: Date.now(),
      },
      tabId,
    );
    return { ok: false, error: 'failed', scanId };
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
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return;

  switch (msg.type) {
    case 'POPUP_SCAN':
      scanActiveTabAndStore(msg.tabId, msg.url, !!msg.fullPage).then(sendResponse);
      return true; // async response

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
