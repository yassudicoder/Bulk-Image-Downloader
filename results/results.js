/**
 * results/results.js — the results page controller. Loads the scan, wires filters, the
 * virtualized grid, selection, keyboard nav, downloads, the full-page rescan, and the
 * one-time analytics opt-in. Depends on BID.{constants,util,i18n,analytics,filters,createGrid,downloads}.
 */
(function () {
  'use strict';
  const { STORAGE, DEFAULTS } = BID.constants;
  const { parseImageUrl, estimateBytes, formatBytes, debounce } = BID.util;
  const t = BID.i18n.t;

  // --- DOM refs --------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const gridScroll = $('gridScroll');
  const gridSizer = $('gridSizer');
  const dupGroups = $('dupGroups');
  const emptyState = $('emptyState');
  const errorState = $('errorState');
  const countLabel = $('countLabel');
  const sourceLabel = $('sourceLabel');
  const filterCount = $('filterCount');
  const selectedLabel = $('selectedLabel');
  const sizeLabel = $('sizeLabel');
  const downloadBtn = $('downloadBtn');
  const downloadZipBtn = $('downloadZipBtn');
  const toastEl = $('toast');
  const main = document.querySelector('.bid-main');

  // Busy overlay (created here so HTML stays declarative).
  const busy = document.createElement('div');
  busy.className = 'bid-busy';
  busy.hidden = true;
  busy.innerHTML = '<div class="bid-busy__box"><div class="bid-spinner" role="status"></div><p class="bid-busy__label" aria-live="polite"></p></div>';
  const busyLabel = busy.querySelector('.bid-busy__label');
  main.appendChild(busy);

  function setBusy(on, label) {
    if (label != null) busyLabel.textContent = label;
    busy.hidden = !on;
  }

  // --- State -----------------------------------------------------------------
  let scanMeta = null;          // stored scan payload (with sourceTabId, scanId)
  let candidates = [];          // hydrated
  let byId = new Map();         // id -> candidate
  let selection = new Set();    // selected ids
  let filterState = Object.assign({}, BID.filters.EMPTY_STATE);
  let filtered = [];
  let grid = null;
  let settings = {};
  let dedupeComputed = false;   // whether _dupGroup tags are current for this candidate set
  let cachedHashed = null;      // last hashAll() result, reused when the threshold slider re-groups
  let dupView = 'all';          // duplicate view: 'all' | 'dup' | 'unique'
  let deduping = false;         // guard against overlapping perceptual-hash runs
  let pageHost = '';            // hostname of the scanned page (for "only from this page")
  let folderRules = [];         // Download-folder routing rules (from options)

  const SOURCE_LABEL_KEY = {
    img: 'sourceImg', srcset: 'sourceSrcset', picture: 'sourcePicture',
    background: 'sourceBackground', lazy: 'sourceLazy', shadow: 'sourceShadow',
  };
  const sourceLabelFor = (s) => t(SOURCE_LABEL_KEY[s] || 'sourceImg');

  // --- Boot ------------------------------------------------------------------
  async function boot() {
    await BID.analytics._hydrate();
    try { const s = await chrome.storage.local.get(STORAGE.settings); settings = s[STORAGE.settings] || {}; } catch (_) { settings = {}; }
    try { const r = await chrome.storage.local.get(STORAGE.folderRules); folderRules = r[STORAGE.folderRules] || []; if (!Array.isArray(folderRules)) folderRules = []; } catch (_) { folderRules = []; }

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
    dedupeComputed = false;
    try { pageHost = new URL(scanMeta.pageUrl).hostname.toLowerCase(); } catch (_) { pageHost = ''; }
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
      onlyThisPage: $('onlyThisPage').checked,
      pageHost: pageHost,
    });
  }

  const applyFiltersDebounced = debounce(applyFilters, 160);
  function applyFilters() {
    readFilterState();
    const base = BID.filters.apply(candidates, filterState);
    updateTabCounts(base);
    let view = base;
    if (dedupeComputed) {
      if (dupView === 'unique') view = collapseDuplicates(base);
      else if (dupView === 'dup') view = base.filter((c) => c._dupGroup != null);
    }
    filtered = sortFiltered(view, currentSort());
    filterCount.textContent = t('filterShownOfTotal', [String(filtered.length), String(candidates.length)]);

    // The Duplicates tab shows per-group cards; every other view uses the flat grid.
    const groupView = (dupView === 'dup' && dedupeComputed);
    gridScroll.hidden = groupView;
    if (dupGroups) dupGroups.hidden = !groupView;
    if (groupView) renderDupGroups(base);
    else grid.setItems(filtered);

    BID.analytics.capture(BID.analytics.EVENTS.FILTER_APPLIED, { count: filtered.length });
  }

  // --- Sorting ---------------------------------------------------------------
  function currentSort() { const el = $('sortBy'); return el ? el.value : 'dom'; }
  function nameOf(c) { return (c.filename || c.url || '').toLowerCase(); }
  // "Largest/Smallest first" sorts by estimated bytes. When the byte estimate is unknown
  // (SVG, or images with no natural dimensions), fall back to a byte proxy in the SAME unit
  // (area × nominal bpp) instead of raw pixel area, which would be ~4× larger and mis-sort.
  function sizeOf(c) { return (c.estBytes && c.estBytes > 0) ? c.estBytes : Math.round(areaOf(c) * 0.25); }
  function sortFiltered(list, mode) {
    const arr = list.slice();
    switch (mode) {
      case 'nameAsc': arr.sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.domIndex - b.domIndex); break;
      case 'sizeDesc': arr.sort((a, b) => (sizeOf(b) - sizeOf(a)) || a.domIndex - b.domIndex); break;
      case 'sizeAsc': arr.sort((a, b) => (sizeOf(a) - sizeOf(b)) || a.domIndex - b.domIndex); break;
      case 'dimDesc': arr.sort((a, b) => (areaOf(b) - areaOf(a)) || a.domIndex - b.domIndex); break;
      default: arr.sort((a, b) => a.domIndex - b.domIndex); break;
    }
    return arr;
  }

  // --- Selection -------------------------------------------------------------
  function toggleSelect(id) {
    if (selection.has(id)) selection.delete(id); else selection.add(id);
    grid.refreshSelection();
    syncDupGroupSelection();
    updateFooter();
  }
  function selectAllFiltered() {
    for (const c of filtered) selection.add(c.id);
    grid.refreshSelection();
    syncDupGroupSelection();
    updateFooter();
  }
  function clearSelection() {
    selection.clear();
    grid.refreshSelection();
    syncDupGroupSelection();
    updateFooter();
  }

  // Keep the group-card checks in sync when selection changes outside the group view.
  function syncDupGroupSelection() {
    if (!dupGroups || dupGroups.hidden) return;
    dupGroups.querySelectorAll('.bid-dupitem').forEach((el) => {
      const on = selection.has(el.dataset.id);
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
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
      downloadZipBtn.disabled = true;
      return;
    }
    selectedLabel.classList.remove('bid-muted');
    selectedLabel.textContent = n === 1 ? t('footerSelectedOne') : t('footerSelectedOther', String(n));
    let sum = 0, known = 0;
    for (const c of selectedCandidates()) { if (c.estBytes) { sum += c.estBytes; known++; } }
    sizeLabel.textContent = known ? t('footerEstSize', formatBytes(sum)) : '';
    downloadBtn.disabled = false;
    downloadZipBtn.disabled = false;
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
    const dupBar = $('dupBar');
    if (!candidates.length) {
      gridScroll.hidden = true;
      if (dupBar) dupBar.hidden = true;
      emptyState.hidden = false;
      return;
    }
    emptyState.hidden = true;
    errorState.hidden = true;
    gridScroll.hidden = false;
    if (dupBar) dupBar.hidden = false;
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

  // Route a download into a Downloads subfolder per the user's folder rules (Pro; open in beta).
  function routeFolder(item, idx) {
    if (!folderRules.length || !BID.folderRules) return '';
    if (!BID.entitlements.isEnabled(BID.entitlements.FLAGS.folderRules)) return '';
    try {
      return BID.folderRules.route({
        domain: item.domain, ext: item.ext, filename: item.filename,
        naturalWidth: item.naturalWidth, naturalHeight: item.naturalHeight,
        displayWidth: item.displayWidth, displayHeight: item.displayHeight,
        index: idx, date: new Date(),
      }, folderRules);
    } catch (_) { return ''; }
  }

  async function downloadItems(items) {
    if (!items || !items.length) { showToast(t('downloadNoneSelected')); return; }
    showToast(items.length === 1 ? t('downloadStartingOne') : t('downloadStartingOther', String(items.length)));
    BID.analytics.capture(
      items.length === 1 ? BID.analytics.EVENTS.DOWNLOAD_INDIVIDUAL : BID.analytics.EVENTS.DOWNLOAD_BATCH,
      { count: items.length, batchSize: items.length },
    );
    const res = await BID.downloads.downloadMany(items, { concurrency: 6, folderFor: routeFolder });
    if (res.failed.length) {
      showToast(
        t('downloadFailedSome', [String(res.failed.length), String(res.total)]),
        { actionLabel: t('downloadRetryFailed'), onAction: () => downloadItems(res.failed.map((f) => f.item)), duration: 6000 },
      );
    } else {
      showToast(t('downloadDone', String(res.started)));
    }
  }

  // --- ZIP download ----------------------------------------------------------
  let zipping = false;
  let zipAbort = null;        // AbortController for the in-flight fetch

  function zipSelected() { return zipItems(selectedCandidates()); }

  async function zipItems(items) {
    if (!items || !items.length) { showToast(t('downloadNoneSelected')); return; }

    // Free-tier gate (a no-op while entitlements.BETA_ALL_FREE is on).
    if (!BID.entitlements.isEnabled(BID.entitlements.FLAGS.bulkZipOver50) &&
        items.length > DEFAULTS.freeZipLimit) {
      showToast(t('zipFreeLimit', String(DEFAULTS.freeZipLimit)));
      return;
    }

    // Cheap upfront guard: refuse selections whose estimated bytes blow the cap
    // before we fetch anything.
    let est = 0;
    for (const c of items) est += c.estBytes || 0;
    if (est > DEFAULTS.zipMaxBytes) { showToast(t('zipTooLarge', formatBytes(DEFAULTS.zipMaxBytes))); return; }

    if (zipping) return;
    zipping = true;
    downloadZipBtn.disabled = true;
    try {
      await runZip(items);
    } catch (_) {
      zipPanelError(t('zipFailed'));
    } finally {
      zipping = false;
      downloadZipBtn.disabled = selection.size === 0;
    }
  }

  async function runZip(items) {
    zipAbort = new AbortController();
    showZipPanel(items.length);

    const { ok, errored } = await fetchBytesHybrid(items,
      (done, total, bytes) => updateZipProgress(done, total, bytes), zipAbort.signal);
    if (zipAbort.signal.aborted) { hideZipPanel(); return; }
    if (!ok.length) { zipPanelError(t('zipNothingFetched')); return; }

    // Real size guard — the upfront estimate can read 0 when dimensions are unknown.
    let actual = 0;
    for (const o of ok) actual += o.bytes.length;
    if (actual > DEFAULTS.zipMaxBytes) { zipPanelError(t('zipTooLarge', formatBytes(DEFAULTS.zipMaxBytes))); return; }

    setZipCompressing();
    const blob = BID.zip.create(buildZipFiles(ok));
    await saveZipBlob(blob);
    zipPanelDone(ok.length, errored, actual);
    BID.analytics.capture(BID.analytics.EVENTS.DOWNLOAD_BATCH, { count: ok.length, zip: true });
  }

  // --- ZIP progress panel ----------------------------------------------------
  function setZipBar(pct) {
    const fill = $('zipBarFill'); if (fill) fill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    const p = $('zipStatPct'); if (p) p.textContent = Math.round(Math.max(0, Math.min(100, pct))) + '%';
  }
  function showZipPanel(total) {
    const panel = $('zipPanel'); if (!panel) return;
    panel.hidden = false;
    panel.classList.remove('is-error', 'is-indeterminate');
    $('zipPanelTitle').textContent = t('zipPanelPackaging');
    $('zipStatNote').textContent = t('zipPanelBgNote');
    $('zipStatCount').textContent = t('zipPanelCount', ['0', String(total)]);
    setZipBar(0);
    $('zipRetryBtn').hidden = true;
    $('zipCloseBtn').hidden = true;
    $('zipCancelBtn').hidden = false;
  }
  function updateZipProgress(done, total, bytes) {
    const panel = $('zipPanel'); if (!panel || panel.hidden) return;
    panel.classList.remove('is-indeterminate');
    setZipBar(total ? (done / total) * 100 : 0);
    const size = bytes ? ' · ' + formatBytes(bytes) : '';
    $('zipStatCount').textContent = t('zipPanelCount', [String(done), String(total)]) + size;
  }
  function setZipCompressing() {
    const panel = $('zipPanel'); if (!panel) return;
    panel.classList.add('is-indeterminate');
    $('zipPanelTitle').textContent = t('zipPanelCompressing');
    $('zipStatNote').textContent = t('zipPanelCompressing');
    const p = $('zipStatPct'); if (p) p.textContent = '';
  }
  function zipPanelDone(count, errored, bytes) {
    const panel = $('zipPanel'); if (!panel) return;
    panel.classList.remove('is-indeterminate', 'is-error');
    setZipBar(100);
    $('zipPanelTitle').textContent = t('zipPanelDone');
    $('zipStatCount').textContent = t('zipPanelSaved', [String(count), formatBytes(bytes)]);
    $('zipCancelBtn').hidden = true;
    $('zipCloseBtn').hidden = false;
    const retry = $('zipRetryBtn');
    if (errored && errored.length) {
      $('zipStatNote').textContent = t('zipPanelPartial', String(errored.length));
      retry.hidden = false;
      retry.textContent = t('zipRetryFailed', String(errored.length));
      const failedItems = errored.map((e) => e.item);
      retry.onclick = () => { hideZipPanel(); zipItems(failedItems); };
    } else {
      $('zipStatNote').textContent = t('zipPanelSavedNote');
      retry.hidden = true;
    }
  }
  function zipPanelError(msg) {
    const panel = $('zipPanel'); if (!panel) return;
    panel.hidden = false;
    panel.classList.add('is-error');
    panel.classList.remove('is-indeterminate');
    setZipBar(100);
    $('zipPanelTitle').textContent = t('zipPanelFailedTitle');
    $('zipStatNote').textContent = msg;
    $('zipStatCount').textContent = '';
    $('zipCancelBtn').hidden = true;
    $('zipRetryBtn').hidden = true;
    $('zipCloseBtn').hidden = false;
  }
  function hideZipPanel() { const p = $('zipPanel'); if (p) p.hidden = true; }

  // Persistent toast with Grant / Skip. The Grant handler calls requestAllUrls()
  // inside the click so the permission request stays within a user gesture.
  function promptGrantAccess(blockedCount) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (v) => { if (!settled) { settled = true; resolve(v); } };
      showToast(t('zipBlockedPrompt', String(blockedCount)), {
        duration: 0,
        actions: [
          { label: t('zipGrantBtn'), primary: true, onAction: () => { BID.imageBytes.requestAllUrls().then(finish); } },
          { label: t('zipSkipBtn'), onAction: () => finish(false) },
        ],
      });
    });
  }

  function buildZipFiles(okList) {
    const used = new Set();
    return okList.map((o, i) => ({ name: uniqueName(BID.downloads.filenameFor(o.item, i), used), data: o.bytes }));
  }

  // Collision-proof names within the archive: "photo.jpg" -> "photo-1.jpg" -> …
  function uniqueName(name, used) {
    if (!used.has(name.toLowerCase())) { used.add(name.toLowerCase()); return name; }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = 1, cand;
    do { cand = stem + '-' + (n++) + ext; } while (used.has(cand.toLowerCase()));
    used.add(cand.toLowerCase());
    return cand;
  }

  function zipFilename() {
    let host = '';
    try { host = new URL(scanMeta.pageUrl).hostname.replace(/^www\./, '').replace(/\./g, '-'); } catch (_) { host = ''; }
    const d = new Date();
    const stamp = '' + d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate());
    const base = host ? ('images-' + host + '-' + stamp) : ('images-' + stamp);
    return BID.downloads.sanitizeFilename(base, 'zip');
  }
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  function saveZipBlob(blob) {
    const url = URL.createObjectURL(blob);
    const filename = zipFilename();
    return new Promise((resolve, reject) => {
      try {
        chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }, (id) => {
          const err = chrome.runtime.lastError;
          // Revoke only after the download has had time to read the blob.
          setTimeout(() => { try { URL.revokeObjectURL(url); } catch (_) {} }, 60000);
          if (err || id == null) reject(err || new Error('no_id')); else resolve(id);
        });
      } catch (e) { try { URL.revokeObjectURL(url); } catch (_) {} reject(e); }
    });
  }

  // Fetch bytes for `items`, running the hybrid-permission flow: try once, and if some
  // fetches fail while we lack <all_urls>, offer to grant it and retry the failures.
  // Shared by the ZIP and dedupe features.
  async function fetchBytesHybrid(items, onProgress, signal) {
    let { ok, errored } = await BID.imageBytes.fetchAll(items, { onProgress, signal });
    if (errored.length && !(signal && signal.aborted) && !(await BID.imageBytes.hasAllUrls())) {
      setBusy(false);
      const granted = await promptGrantAccess(errored.length);
      if (granted && !(signal && signal.aborted)) {
        const retry = await BID.imageBytes.fetchAll(errored.map((e) => e.item), { onProgress, signal });
        ok = ok.concat(retry.ok);
        errored = retry.errored;
      }
    }
    return { ok, errored };
  }

  // --- Duplicate view (All / Duplicates / Unique + live sensitivity) ---------
  // Perceptual hashing is expensive (it fetches every image), so it runs lazily the first
  // time the user opens a duplicate-aware tab; the slider then re-groups the cached hashes
  // in place, with no re-fetch or re-hash.
  function currentThreshold() {
    const el = $('dupThreshold');
    return clampThreshold(el ? el.value : settings.dedupeHammingThreshold);
  }

  async function setDupView(view) {
    if (view !== 'all' && view !== 'dup' && view !== 'unique') return;
    if (view === dupView) return;
    // Duplicates / Unique need the perceptual hashes; compute them on first use.
    if ((view === 'dup' || view === 'unique') && !dedupeComputed) {
      const ok = await ensureDedupe();
      if (!ok) return; // hashing failed or was cancelled — stay on the current tab
    }
    dupView = view;
    updateTabsUI();
    applyFilters();
    updateFooter();
  }

  async function ensureDedupe() {
    if (deduping) return false;
    deduping = true;
    try {
      const res = await runDedupe();
      if (res && res.limited) showToast(t('dedupeLimited'));
      return true;
    } catch (_) {
      showToast(t('dedupeFailed'));
      return false;
    } finally {
      deduping = false;
      setBusy(false);
    }
  }

  async function runDedupe() {
    for (const c of candidates) { c._dupGroup = null; c._dupBytes = 0; }
    cachedHashed = null;
    setBusy(true, t('dedupePreparing', String(candidates.length)));

    const { ok } = await fetchBytesHybrid(candidates,
      (d, tot) => setBusy(true, t('dedupeFetching', [String(d), String(tot)])));
    if (!ok.length) { dedupeComputed = true; return { dupCount: 0, groupCount: 0, limited: false }; }

    const hashed = await BID.dedupe.hashAll(ok,
      { onProgress: (d, tot) => setBusy(true, t('dedupeComparing', [String(d), String(tot)])) });
    cachedHashed = hashed;
    const res = BID.dedupe.markDuplicates(hashed, currentThreshold());
    dedupeComputed = true;
    BID.analytics.capture(BID.analytics.EVENTS.DEDUPE_RUN, { count: res.dupCount, total: candidates.length });
    return res;
  }

  // Re-group already-hashed images at a new threshold — cheap, so it can run on slider drag.
  function regroupAtThreshold() {
    if (!dedupeComputed || !cachedHashed) return;
    BID.dedupe.markDuplicates(cachedHashed, currentThreshold());
    applyFilters();
    updateFooter();
  }
  const regroupDebounced = debounce(regroupAtThreshold, 120);

  // Collapse duplicate groups in the visible list: keep the largest member present, drop
  // the rest. Choosing the representative from what's already visible means a group never
  // vanishes just because its best copy was excluded by another filter.
  function collapseDuplicates(list) {
    const best = new Map(); // group key -> chosen candidate
    for (const c of list) {
      if (c._dupGroup == null) continue;
      const cur = best.get(c._dupGroup);
      if (!cur || betterRep(c, cur)) best.set(c._dupGroup, c);
    }
    const keepIds = new Set();
    for (const c of best.values()) keepIds.add(c.id);
    const out = [];
    for (const c of list) {
      if (c._dupGroup != null && !keepIds.has(c.id)) continue;
      out.push(c);
    }
    return out;
  }

  function areaOf(c) { return (c.naturalWidth || c.displayWidth || 0) * (c.naturalHeight || c.displayHeight || 0); }
  function betterRep(a, b) {
    const aa = areaOf(a), ba = areaOf(b);
    if (aa !== ba) return aa > ba;
    return (a._dupBytes || 0) > (b._dupBytes || 0);
  }

  function clampThreshold(v) {
    v = parseInt(v, 10);
    if (isNaN(v)) v = DEFAULTS.dedupeHammingThreshold;
    return Math.max(0, Math.min(16, v));
  }

  // --- Duplicates group cards ------------------------------------------------
  // Build the near-duplicate groups (>= 2 members) from the base-filtered set, keeper
  // (largest) first within each group and largest groups first.
  function groupsFrom(list) {
    const map = new Map();
    for (const c of list) {
      if (c._dupGroup == null) continue;
      let arr = map.get(c._dupGroup);
      if (!arr) { arr = []; map.set(c._dupGroup, arr); }
      arr.push(c);
    }
    const groups = [];
    for (const arr of map.values()) {
      if (arr.length < 2) continue;
      arr.sort((a, b) => (areaOf(b) - areaOf(a)) || a.domIndex - b.domIndex);
      groups.push(arr);
    }
    groups.sort((a, b) => (b.length - a.length) || (a[0].domIndex - b[0].domIndex));
    return groups;
  }

  function renderDupGroups(base) {
    if (!dupGroups) return;
    const groups = groupsFrom(base);
    dupGroups.textContent = '';

    const meta = document.createElement('p');
    meta.className = 'bid-dupmeta';
    meta.textContent = t('dupGroupsMeta', [String(groups.length), String(currentThreshold())]);
    dupGroups.appendChild(meta);

    if (!groups.length) {
      const empty = document.createElement('p');
      empty.className = 'bid-hint bid-dupgroups__empty';
      empty.textContent = t('dupGroupsEmpty');
      dupGroups.appendChild(empty);
      return;
    }
    groups.forEach((members, gi) => dupGroups.appendChild(buildGroupCard(members, gi)));
  }

  function buildGroupCard(members, gi) {
    const card = document.createElement('div');
    card.className = 'bid-dupgroup';

    const head = document.createElement('div');
    head.className = 'bid-dupgroup__head';
    const title = document.createElement('span');
    title.className = 'bid-dupgroup__title';
    title.textContent = t('dupGroupTitle', String(gi + 1));
    const count = document.createElement('span');
    count.className = 'bid-dupgroup__count';
    count.textContent = members.length === 1 ? t('dupGroupCopiesOne') : t('dupGroupCopies', String(members.length));
    const best = document.createElement('button');
    best.type = 'button';
    best.className = 'bid-btn bid-btn--sm bid-dupgroup__best';
    best.textContent = t('dupGroupKeepBest');
    best.addEventListener('click', () => keepBest(members, card));
    head.append(title, count, best);

    const strip = document.createElement('div');
    strip.className = 'bid-dupgroup__items';
    members.forEach((item, mi) => strip.appendChild(buildDupItem(item, mi === 0)));

    card.append(head, strip);
    return card;
  }

  function buildDupItem(item, isKeeper) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'bid-dupitem' + (isKeeper ? ' is-keeper' : '');
    el.dataset.id = item.id;
    el.classList.toggle('is-selected', selection.has(item.id));
    el.setAttribute('aria-pressed', selection.has(item.id) ? 'true' : 'false');

    const img = document.createElement('img');
    img.className = 'bid-dupitem__thumb';
    img.loading = 'lazy'; img.decoding = 'async'; img.alt = item.alt || '';
    img.src = item.url;
    img.onerror = () => { el.classList.add('is-broken'); };
    el.appendChild(img);

    const w = item.naturalWidth || item.displayWidth || 0, h = item.naturalHeight || item.displayHeight || 0;
    if (w && h) {
      const dims = document.createElement('span');
      dims.className = 'bid-dupitem__dims';
      dims.textContent = w + '×' + h;
      el.appendChild(dims);
    }
    if (isKeeper) {
      const kb = document.createElement('span');
      kb.className = 'bid-badge bid-dupitem__keep';
      kb.textContent = t('dupGroupKeep');
      el.appendChild(kb);
    }
    el.title = item.filename || item.url || '';
    el.addEventListener('click', () => toggleSelect(item.id)); // toggleSelect syncs the card
    return el;
  }

  // "Keep best": select the largest copy, deselect the rest of the group.
  function keepBest(members, card) {
    members.forEach((item, i) => { if (i === 0) selection.add(item.id); else selection.delete(item.id); });
    grid.refreshSelection();
    updateFooter();
    card.querySelectorAll('.bid-dupitem').forEach((el) => {
      const on = selection.has(el.dataset.id);
      el.classList.toggle('is-selected', on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Tab counts reflect the current base-filtered set. Dup/Unique stay blank until hashing runs.
  function updateTabCounts(base) {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('tabCountAll', String(base.length));
    if (dedupeComputed) {
      set('tabCountDup', String(base.filter((c) => c._dupGroup != null).length));
      set('tabCountUnique', String(collapseDuplicates(base).length));
    } else {
      set('tabCountDup', '');
      set('tabCountUnique', '');
    }
  }

  function updateTabsUI() {
    for (const tab of document.querySelectorAll('.bid-dup-tab')) {
      const on = tab.getAttribute('data-dup-view') === dupView;
      tab.classList.toggle('is-active', on);
      tab.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  function resetDedupeState() {
    dedupeComputed = false;
    cachedHashed = null;
    dupView = 'all';
    for (const c of candidates) c._dupGroup = null;
    updateTabsUI();
  }

  // --- Full-page rescan ------------------------------------------------------
  async function rescanFullPage() {
    if (!scanMeta || scanMeta.sourceTabId == null) { showToast(t('rescanFailed')); return; }
    setBusy(true, t('resultsFullPageRunning'));
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
      resetDedupeState();
      render();

      const delta = candidates.length - prevCount;
      showToast(delta > 0 ? t('resultsFullPageAdded', String(delta)) : t('resultsFullPageNoNew'));
      BID.analytics.capture(BID.analytics.EVENTS.SCAN_FULL_PAGE, { count: candidates.length });
    } catch (_) {
      showToast(t('rescanFailed'));
    } finally {
      setBusy(false);
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
    $('onlyThisPage').addEventListener('change', applyFilters);
    $('sortBy').addEventListener('change', applyFilters);
    $('resetFilters').addEventListener('click', () => {
      ['minWidth', 'minHeight', 'nameContains'].forEach((id) => { $(id).value = ''; });
      $('fileType').value = ''; $('domain').value = ''; $('onlyThisPage').checked = false;
      applyFilters();
    });
    $('selectAllBtn').addEventListener('click', selectAllFiltered);
    $('clearSelBtn').addEventListener('click', clearSelection);
    downloadBtn.addEventListener('click', () => downloadItems(selectedCandidates()));
    downloadZipBtn.addEventListener('click', zipSelected);
    const zipCancel = $('zipCancelBtn');
    if (zipCancel) zipCancel.addEventListener('click', () => { if (zipAbort) zipAbort.abort(); hideZipPanel(); });
    const zipClose = $('zipCloseBtn');
    if (zipClose) zipClose.addEventListener('click', hideZipPanel);

    setupDupControls();

    const thumb = $('thumbSize');
    thumb.addEventListener('input', () => grid.setThumbSize(parseInt(thumb.value, 10)));
    thumb.addEventListener('change', async () => {
      settings = Object.assign({}, settings, { thumbSize: parseInt(thumb.value, 10) });
      try { await chrome.storage.local.set({ [STORAGE.settings]: settings }); } catch (_) {}
    });
  }

  // Duplicate-view tabs + sensitivity slider (the toolbar above the grid).
  function setupDupControls() {
    for (const tab of document.querySelectorAll('.bid-dup-tab')) {
      tab.addEventListener('click', () => setDupView(tab.getAttribute('data-dup-view')));
    }
    const thresh = $('dupThreshold');
    if (!thresh) return;
    const init = clampThreshold(settings.dedupeHammingThreshold);
    thresh.value = String(init);
    const out = $('dupThresholdVal'); if (out) out.textContent = String(init);
    thresh.addEventListener('input', () => {
      const v = clampThreshold(thresh.value);
      const o = $('dupThresholdVal'); if (o) o.textContent = String(v);
      regroupDebounced();
    });
    thresh.addEventListener('change', async () => {
      settings = Object.assign({}, settings, { dedupeHammingThreshold: clampThreshold(thresh.value) });
      try { await chrome.storage.local.set({ [STORAGE.settings]: settings }); } catch (_) {}
    });
  }

  // Controls that must work even when the scan errors out early, so the header /
  // empty-state buttons and the analytics prompt are never dead. Wired before
  // boot()'s error returns; must not depend on the grid or scan payload.
  function setupStaticControls() {
    $('scanFullPageBtn').addEventListener('click', rescanFullPage);
    $('emptyScanFullPage').addEventListener('click', rescanFullPage);
    $('optionsBtn').addEventListener('click', () => {
      // Navigate this same tab to Settings (single-tab UX); pass the scan so Settings can
      // offer "Back to results" without losing the current scan.
      const sid = new URLSearchParams(location.search).get('scan') || '';
      location.href = chrome.runtime.getURL('options/options.html') + (sid ? ('?scan=' + encodeURIComponent(sid)) : '');
    });

    $('analyticsYes').addEventListener('click', () => { BID.analytics.setOptIn(true); hideAnalyticsPrompt(); });
    $('analyticsNo').addEventListener('click', () => { BID.analytics.setOptIn(false); hideAnalyticsPrompt(); });

    const upgrade = $('upgradeProBtn');
    if (upgrade) upgrade.addEventListener('click', () => showToast(t('upgradeProToast')));

    setupThemeToggle();
    setupKebab();
  }

  // --- Header: theme toggle + overflow menu ----------------------------------
  function effectiveTheme() {
    const pref = (BID.theme && BID.theme.get) ? BID.theme.get() : 'auto';
    if (pref === 'dark' || pref === 'light') return pref;
    try { return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) { return 'light'; }
  }
  function updateThemeIcon() {
    const dark = effectiveTheme() === 'dark';
    const moon = $('iconMoon'), sun = $('iconSun');
    if (moon) moon.hidden = dark;   // show the moon while light (click -> dark)
    if (sun) sun.hidden = !dark;    // show the sun while dark  (click -> light)
  }
  function setupThemeToggle() {
    const btn = $('themeToggle');
    if (!btn || !BID.theme) return;
    updateThemeIcon();
    btn.addEventListener('click', () => {
      BID.theme.set(effectiveTheme() === 'dark' ? 'light' : 'dark');
      updateThemeIcon();
    });
    try {
      window.addEventListener('storage', (e) => { if (e.key === 'bid:theme') updateThemeIcon(); });
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeIcon);
    } catch (_) {}
  }
  function setupKebab() {
    const btn = $('kebabBtn'), menu = $('kebabMenu');
    if (!btn || !menu) return;
    const items = Array.from(menu.querySelectorAll('.bid-menu__item'));
    items.forEach((it) => { it.tabIndex = -1; }); // roving tabindex

    const isOpen = () => !menu.hidden;
    function focusItem(i) {
      const n = items.length; if (!n) return;
      const idx = ((i % n) + n) % n;
      items.forEach((it, j) => { it.tabIndex = j === idx ? 0 : -1; });
      items[idx].focus();
    }
    function open(focusFirst) {
      menu.hidden = false; btn.setAttribute('aria-expanded', 'true');
      if (focusFirst) focusItem(0);
    }
    function close(returnFocus) {
      if (menu.hidden) return;
      const hadFocus = menu.contains(document.activeElement);
      menu.hidden = true; btn.setAttribute('aria-expanded', 'false');
      if (returnFocus || hadFocus) btn.focus(); // restore focus for keyboard users
    }

    btn.addEventListener('click', (e) => { e.stopPropagation(); if (isOpen()) close(false); else open(false); });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); open(true); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); open(false); focusItem(items.length - 1); }
    });
    menu.addEventListener('keydown', (e) => {
      const idx = items.indexOf(document.activeElement);
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); focusItem(idx + 1); break;
        case 'ArrowUp': e.preventDefault(); focusItem(idx - 1); break;
        case 'Home': e.preventDefault(); focusItem(0); break;
        case 'End': e.preventDefault(); focusItem(items.length - 1); break;
        case 'Escape': e.preventDefault(); close(true); break;
        case 'Tab': close(false); break;
        default: break;
      }
    });
    document.addEventListener('click', (e) => { if (isOpen() && e.target !== btn && !menu.contains(e.target)) close(false); });

    const help = $('menuHelp');
    if (help) help.addEventListener('click', () => { close(false); location.href = chrome.runtime.getURL('welcome/welcome.html'); });
    const about = $('menuAbout');
    if (about) about.addEventListener('click', () => { close(true); showToast(t('aboutLine', BID.constants.EXT_VERSION)); });
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

    const actions = options.actions
      || (options.actionLabel ? [{ label: options.actionLabel, onAction: options.onAction }] : []);
    for (const a of actions) {
      const b = document.createElement('button');
      b.className = 'bid-toast__action' + (a.primary ? ' bid-toast__action--primary' : '');
      b.textContent = a.label;
      b.addEventListener('click', () => { hideToast(); if (a.onAction) a.onAction(); });
      toastEl.appendChild(b);
    }

    toastEl.hidden = false;
    if (toastTimer) clearTimeout(toastTimer);
    // duration: 0 means persist until dismissed (needed for the grant-access prompt).
    const dur = options.duration == null ? 3200 : options.duration;
    if (dur) toastTimer = setTimeout(hideToast, dur);
  }
  function hideToast() { toastEl.hidden = true; }

  // --- Go --------------------------------------------------------------------
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
