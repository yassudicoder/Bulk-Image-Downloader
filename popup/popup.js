/**
 * popup/popup.js — the toolbar popup. Opening the popup (a user gesture on the action)
 * grants activeTab, so we ask the service worker to scan the active tab and show a summary.
 * "View Results" opens the full results page — the big screen — which reads the stashed scan.
 */
(function () {
  'use strict';
  const t = BID.i18n.t;
  const $ = (id) => document.getElementById(id);

  const STATES = ['stateLoading', 'stateResult', 'stateRestricted', 'stateError'];
  let lastScanId = null;

  function show(stateId) {
    for (const s of STATES) $(s).hidden = (s !== stateId);
  }

  function getActiveTab() {
    return new Promise((resolve) => {
      try {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => resolve((tabs && tabs[0]) || null));
      } catch (_) { resolve(null); }
    });
  }

  function sendScan(tab, fullPage) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { type: 'POPUP_SCAN', tabId: tab.id, url: tab.url || '', fullPage: !!fullPage },
          (resp) => resolve(chrome.runtime.lastError ? { ok: false, error: 'msg' } : (resp || { ok: false, error: 'empty' })),
        );
      } catch (_) { resolve({ ok: false, error: 'exception' }); }
    });
  }

  async function runScan(fullPage) {
    $('loadingText').textContent = t(fullPage ? 'popupScanningFull' : 'popupScanning');
    show('stateLoading');

    const tab = await getActiveTab();
    if (!tab || tab.id == null) { show('stateError'); return; }

    const res = await sendScan(tab, fullPage);
    if (res.restricted) { show('stateRestricted'); return; }
    if (!res.ok) { show('stateError'); return; }

    lastScanId = res.scanId;
    renderResult(res);
  }

  function renderResult(res) {
    const count = res.count || 0;
    show('stateResult');

    if (count === 0) {
      $('countLine').hidden = true;
      $('hostLine').hidden = true;
      $('noImages').hidden = false;
      $('viewResults').hidden = true;
      $('scanFull').classList.add('bid-btn--primary');
      return;
    }

    $('noImages').hidden = true;
    $('viewResults').hidden = false;
    $('scanFull').classList.remove('bid-btn--primary');

    $('countLine').hidden = false;
    $('countNum').textContent = count.toLocaleString();
    $('countText').textContent = count === 1 ? t('popupFoundOne') : t('popupFoundOther');

    let host = '';
    try { host = new URL(res.pageUrl).hostname.replace(/^www\./, ''); } catch (_) { host = ''; }
    $('hostLine').textContent = host ? t('popupFrom', host) : '';
    $('hostLine').hidden = !host;
  }

  function openResults() {
    if (!lastScanId) return;
    const url = chrome.runtime.getURL('results/results.html') + '?scan=' + encodeURIComponent(lastScanId);
    try { chrome.tabs.create({ url }); } catch (_) {}
    window.close();
  }

  function boot() {
    $('viewResults').addEventListener('click', openResults);
    $('scanFull').addEventListener('click', () => runScan(true));
    $('retry').addEventListener('click', () => runScan(false));
    $('settingsBtn').addEventListener('click', () => {
      try { chrome.runtime.openOptionsPage(); } catch (_) {}
      window.close();
    });
    $('helpBtn').addEventListener('click', () => {
      try { chrome.tabs.create({ url: chrome.runtime.getURL('welcome/welcome.html') }); } catch (_) {}
      window.close();
    });

    runScan(false);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
