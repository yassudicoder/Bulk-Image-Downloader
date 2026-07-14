/**
 * results/results.js — the results page controller. Loads the scan, wires filters, the
 * virtualized grid, selection, keyboard nav, downloads, the full-page rescan, and the
 * one-time analytics opt-in. Depends on BID.{constants,util,i18n,analytics,filters,createGrid,downloads}.
 */
(function () {
  'use strict';
  const { STORAGE } = BID.constants;
  const { parseImageUrl, estimateBytes, formatBytes, debounce } = BID.util;
  const t = BID.i18n.t;

  // --- DOM refs --------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const gridScroll = $('gridScroll');
  const gridSizer = $('gridSizer');
  const emptyState = $('emptyState');
  const errorState = $('errorState');
  const countLabel = $('countLabel');
  const sourceLabel = $('sourceLabel');
  const filterCount = $('filterCount');
  const selectedLabel = $('selectedLabel');
  const sizeLabel = $('sizeLabel');
  const downloadBtn = $('downloadBtn');
  const toastEl = $('toast');
  const main = document.querySelector('.bid-main');

  // Busy overlay (created here so HTML stays declarative).
  const busy = document.createElement('div');
  busy.className = 'bid-busy';
  busy.hidden = true;
  busy.innerHTML = '<div class="bid-spinner" role="status" aria-label="' + escapeAttr(t('resultsFullPageRunning')) + '"></div>';
  main.appendChild(busy);

  function escapeAttr(s) { return String(s == null ? '' : s).replace(/"/g, '&quot;'); }

  // --- State -----------------------------------------------------------------
  let scanMeta = null;          // stored scan payload (with sourceTabId, scanId)
  let candidates = [];          // hydrated
  let byId = new Map();         // id -> candidate
  let selection = new Set();    // selected ids
  let filterState = Object.assign({}, BID.filters.EMPTY_STATE);
  let filtered = [];
  let grid = null;
  let settings = {};

  const SOURCE_LABEL_KEY = {
    img: 'sourceImg', srcset: 'sourceSrcset', picture: 'sourcePicture',
    background: 'sourceBackground', lazy: 'sourceLazy', shadow: 'sourceShadow',
  };
  const sourceLabelFor = (s) => t(SOURCE_LABEL_KEY[s] || 'sourceImg');

  // --- Boot ------------------------------------------------------------------
  async function boot() {
    await BID.analytics._hydrate();
    try { const s = await chrome.storage.local.get(STORAGE.settings); settings = s[STORAGE.settings] || {}; } catch (_) { settings = {}; }

    setupStaticControls();

    const scanId = new URLSearchParams(location.search).get('scan');
    if (!scanId) return showError('errorBody');

    let payload = null;
    try {
      const key = STORAGE.scanPrefix + scanId;
      const got = await chrome.storage.session.get(key);
      payload = got[key];
    } catch (_) { /* ignore */ }

    if (!payload) return showError('errorBody');
    if (payload.error === 'restricted') return showError('errorRestricted');
    if (payload.ok === false || payload.error) return showError('errorBody');

    scanMeta = payload;
    ingest(payload.candidates || []);
    setupFilterFacets();
    setupControls();
    setupKeyboard();
    setupGrid();
    maybeShowAnalyticsPrompt();
    render();

    BID.analytics.capture(BID.analytics.EVENTS.SCAN_RUN, {
      count: candidates.length, durationMs: (payload.stats && payload.stats.durationMs) || 0,
      fullPage: !!payload.fullPage,
    });
  }

  function ingest(rawCandidates) {
    candidates = rawCandidates.map((c) => {
      const parsed = parseImageUrl(c.url, c.pageUrl);
      const ext = c.ext || parsed.ext || '';
      return Object.assign({}, c, {
        ext,
        domain: c.domain || parsed.domain || '',
        estBytes: estimateBytes(c.naturalWidth, c.naturalHeight, ext),
      });
    });
    byId = new Map(candidates.map((c) => [c.id, c]));
  }

  // --- Header / source -------------------------------------------------------
  function updateHeader() {
    const n = candidates.length;
    countLabel.textContent = n === 1 ? t('resultsFoundOne') : t('resultsFoundOther', String(n));
    let dom = '';
    try { dom = new URL(scanMeta.pageUrl).hostname; } catch (_) { dom = scanMeta.pageUrl || ''; }
    sourceLabel.textContent = dom ? t('resultsSourceFrom', dom) : '';
    sourceLabel.title = scanMeta.pageUrl || '';
  }

  // --- Filters ---------------------------------------------------------------
  function setupFilterFacets() {
    const facets = BID.filters.computeFacets(candidates);
    const typeSel = $('fileType');
    for (const ty of facets.types) {
      const o = document.createElement('option');
      o.value = ty; o.textContent = ty.toUpperCase();
      typeSel.appendChild(o);
    }
    const domSel = $('domain');
    for (const d of facets.domains) {
      const o = document.createElement('option');
      o.value = d; o.textContent = d;
      domSel.appendChild(o);
    }
  }

  function readFilterState() {
    filterState = BID.filters.normalizeState({
      minWidth: $('minWidth').value,
      minHeight: $('minHeight').value,
      fileType: $('fileType').value,
      domain: $('domain').value,
      nameContains: $('nameContains').value,
      hideDuplicates: false,
    });
  }

  const applyFiltersDebounced = debounce(applyFilters, 160);
  function applyFilters() {
    readFilterState();
    filtered = BID.filters.apply(candidates, filterState);
    filterCount.textContent = t('filterShownOfTotal', [String(filtered.length), String(candidates.length)]);
    grid.setItems(filtered);
    BID.analytics.capture(BID.analytics.EVENTS.FILTER_APPLIED, { count: filtered.length });
  }

  // --- Selection -------------------------------------------------------------
  function toggleSelect(id) {
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    grid.refreshSelection();
    updateFooter();
  }
  function selectAllFiltered() {
    for (const c of filtered) selection.add(c.id);
    grid.refreshSelection();
    updateFooter();
  }
  function clearSelection() {
    selection.clear();
    grid.refreshSelection();
    updateFooter();
  }

  function selectedCandidates() {
    const out = [];
    for (const id of selection) { const c = byId.get(id); if (c) out.push(c); }
    out.sort((a, b) => a.domIndex - b.domIndex);
    return out;
  }

  function updateFooter() {
    const n = selection.size;
    if (!n) {
      selectedLabel.textContent = t('footerNothingSelected');
      selectedLabel.classList.add('bid-muted');
      sizeLabel.textContent = '';
      downloadBtn.disabled = true;
      return;
    }
    selectedLabel.classList.remove('bid-muted');
    selectedLabel.textContent = n === 1 ? t('footerSelectedOne') : t('footerSelectedOther', String(n));
    let sum = 0, known = 0;
    for (const c of selectedCandidates()) { if (c.estBytes) { sum += c.estBytes; known++; } }
    sizeLabel.textContent = known ? t('footerEstSize', formatBytes(sum)) : '';
    downloadBtn.disabled = false;
  }

  // --- Grid ------------------------------------------------------------------
  function setupGrid() {
    const initialThumb = parseInt(settings.thumbSize, 10) || 150;
    $('thumbSize').value = initialThumb;
    grid = BID.createGrid({
      scrollEl: gridScroll,
      sizerEl: gridSizer,
      thumbSize: initialThumb,
      strings: {
        select: t('gridSelectImage'), open: t('gridOpenOriginal'),
        download: t('gridDownloadThis'), sizeUnknown: t('gridSizeUnknown'),
        broken: t('gridBrokenImage'),
      },
      sourceLabel: sourceLabelFor,
      isSelected: (id) => selection.has(id),
      onToggle: (id) => toggleSelect(id),
      onDownload: (item, idx) => downloadItems([item]),
      onOpen: (item) => openOriginal(item),
    });
  }

  function render() {
    updateHeader();
    if (!candidates.length) {
      gridScroll.hidden = true;
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;
    errorState.hidden = true;
    gridScroll.hidden = false;
    applyFilters();
    updateFooter();
  }

  function showError(bodyKey) {
    gridScroll.hidden = true;
    emptyState.hidden = true;
    errorState.hidden = false;
    document.getElementById('errorBody').textContent = t(bodyKey);
    downloadBtn.disabled = true;
  }

  // --- Downloads -------------------------------------------------------------
  function openOriginal(item) {
    try { chrome.tabs.create({ url: item.url, active: false }); }
    catch (_) { window.open(item.url, '_blank'); }
  }

  async function downloadItems(items) {
    if (!items || !items.length) { showToast(t('downloadNoneSelected')); return; }
    showToast(items.length === 1 ? t('downloadStartingOne') : t('downloadStartingOther', String(items.length)));
    BID.analytics.capture(
      items.length === 1 ? BID.analytics.EVENTS.DOWNLOAD_INDIVIDUAL : BID.analytics.EVENTS.DOWNLOAD_BATCH,
      { count: items.length, batchSize: items.length },
    );
    const res = await BID.downloads.downloadMany(items, { concurrency: 6 });
    if (res.failed.length) {
      showToast(
        t('downloadFailedSome', [String(res.failed.length), String(res.total)]),
        { actionLabel: t('downloadRetryFailed'), onAction: () => downloadItems(res.failed.map((f) => f.item)), duration: 6000 },
      );
    } else {
      showToast(t('downloadDone', String(res.started)));
    }
  }

  // --- Full-page rescan ------------------------------------------------------
  async function rescanFullPage() {
    if (!scanMeta || scanMeta.sourceTabId == null) { showToast(t('rescanFailed')); return; }
    busy.hidden = false;
    const prevCount = candidates.length;
    const prevSelectedUrls = new Set(selectedCandidates().map((c) => c.url));
    try {
      const resp = await chrome.runtime.sendMessage({ type: 'BID_RESCAN_FULLPAGE', tabId: scanMeta.sourceTabId });
      if (!resp || !resp.ok) { showToast(t('rescanFailed')); return; }
      const key = STORAGE.scanPrefix + resp.scanId;
      const got = await chrome.storage.session.get(key);
      const payload = got[key];
      if (!payload || payload.ok === false) { showToast(t('rescanFailed')); return; }

      scanMeta = payload;
      ingest(payload.candidates || []);
      // Preserve selection by URL (ids are re-minted each scan).
      selection = new Set(candidates.filter((c) => prevSelectedUrls.has(c.url)).map((c) => c.id));
      // Rebuild facet dropdowns (new domains/types may have appeared).
      resetFacetOptions();
      setupFilterFacets();
      render();

      const delta = candidates.length - prevCount;
      showToast(delta > 0 ? t('resultsFullPageAdded', String(delta)) : t('resultsFullPageNoNew'));
      BID.analytics.capture(BID.analytics.EVENTS.SCAN_FULL_PAGE, { count: candidates.length });
    } catch (_) {
      showToast(t('rescanFailed'));
    } finally {
      busy.hidden = true;
    }
  }

  function resetFacetOptions() {
    const typeSel = $('fileType');
    const domSel = $('domain');
    while (typeSel.options.length > 1) typeSel.remove(1);
    while (domSel.options.length > 1) domSel.remove(1);
  }

  // --- Controls wiring -------------------------------------------------------
  function setupControls() {
    ['minWidth', 'minHeight', 'fileType', 'domain'].forEach((id) => {
      $(id).addEventListener('change', applyFilters);
    });
    $('nameContains').addEventListener('input', applyFiltersDebounced);
    $('resetFilters').addEventListener('click', () => {
      ['minWidth', 'minHeight', 'nameContains'].forEach((id) => { $(id).value = ''; });
      $('fileType').value = ''; $('domain').value = '';
      applyFilters();
    });
    $('selectAllBtn').addEventListener('click', selectAllFiltered);
    $('clearSelBtn').addEventListener('click', clearSelection);
    downloadBtn.addEventListener('click', () => downloadItems(selectedCandidates()));

    const thumb = $('thumbSize');
    thumb.addEventListener('input', () => grid.setThumbSize(parseInt(thumb.value, 10)));
    thumb.addEventListener('change', async () => {
      settings = Object.assign({}, settings, { thumbSize: parseInt(thumb.value, 10) });
      try { await chrome.storage.local.set({ [STORAGE.settings]: settings }); } catch (_) {}
    });
  }

  // Controls that must work even when the scan errors out early, so the header /
  // empty-state buttons and the analytics prompt are never dead. Wired before
  // boot()'s error returns; must not depend on the grid or scan payload.
  function setupStaticControls() {
    $('scanFullPageBtn').addEventListener('click', rescanFullPage);
    $('emptyScanFullPage').addEventListener('click', rescanFullPage);
    $('optionsBtn').addEventListener('click', () => { try { chrome.runtime.openOptionsPage(); } catch (_) {} });

    $('analyticsYes').addEventListener('click', () => { BID.analytics.setOptIn(true); hideAnalyticsPrompt(); });
    $('analyticsNo').addEventListener('click', () => { BID.analytics.setOptIn(false); hideAnalyticsPrompt(); });
  }

  // --- Keyboard --------------------------------------------------------------
  function setupKeyboard() {
    gridScroll.addEventListener('keydown', (e) => {
      const count = grid.getCount();
      if (!count) return;
      const cols = grid.getCols();
      let idx = grid.getFocus();
      if (idx < 0) idx = 0;

      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        e.preventDefault(); selectAllFiltered(); return;
      }
      switch (e.key) {
        case 'ArrowRight': e.preventDefault(); grid.setFocus(Math.min(count - 1, idx + 1)); break;
        case 'ArrowLeft': e.preventDefault(); grid.setFocus(Math.max(0, idx - 1)); break;
        case 'ArrowDown': e.preventDefault(); grid.setFocus(Math.min(count - 1, idx + cols)); break;
        case 'ArrowUp': e.preventDefault(); grid.setFocus(Math.max(0, idx - cols)); break;
        case 'Home': e.preventDefault(); grid.setFocus(0); break;
        case 'End': e.preventDefault(); grid.setFocus(count - 1); break;
        case ' ': case 'Spacebar': {
          e.preventDefault();
          const item = grid.getItemAt(grid.getFocus());
          if (item) toggleSelect(item.id);
          break;
        }
        case 'Enter': {
          const item = grid.getItemAt(grid.getFocus());
          if (item) openOriginal(item);
          break;
        }
        default: break;
      }
    });
  }

  // --- Analytics prompt ------------------------------------------------------
  function maybeShowAnalyticsPrompt() {
    if (!BID.analytics.wasAsked()) $('analyticsPrompt').hidden = false;
  }
  function hideAnalyticsPrompt() { $('analyticsPrompt').hidden = true; }

  // --- Toast -----------------------------------------------------------------
  let toastTimer = null;
  function showToast(msg, o) {
    const options = o || {};
    toastEl.textContent = '';
    const span = document.createElement('span');
    span.textContent = msg;
    toastEl.appendChild(span);
    if (options.actionLabel) {
      const b = document.createElement('button');
      b.className = 'bid-toast__action';
      b.textContent = options.actionLabel;
      b.addEventListener('click', () => { hideToast(); if (options.onAction) options.onAction(); });
      toastEl.appendChild(b);
    }
    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    const dur = options.duration || 3200;
    if (dur) toastTimer = setTimeout(hideToast, dur);
  }
  function hideToast() { toastEl.hidden = true; }

  // --- Go --------------------------------------------------------------------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
