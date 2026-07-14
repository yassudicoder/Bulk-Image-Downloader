/**
 * results/grid.js — windowed (virtualized) image grid. BID.createGrid.
 *
 * Only the cells inside (or near) the viewport exist in the DOM at any moment, so the grid
 * stays smooth at thousands of items and thumbnails load lazily as a side effect of only
 * visible cells having <img>. Cell DOM is recycled by add/remove diffing per scroll frame.
 */
(function () {
  'use strict';
  const g = self;
  g.BID = g.BID || {};
  const { rafThrottle, escapeHtml } = g.BID.util;

  const CELL_TEMPLATE = (function () {
    const t = document.createElement('template');
    t.innerHTML =
      '<div class="bid-cell" role="gridcell" tabindex="-1">' +
        '<input type="checkbox" class="bid-cell__check" tabindex="-1">' +
        '<span class="bid-badge bid-cell__source"></span>' +
        '<div class="bid-cell__thumbwrap">' +
          '<img class="bid-cell__thumb" loading="lazy" decoding="async" alt="">' +
          '<div class="bid-cell__broken"></div>' +
        '</div>' +
        '<div class="bid-cell__dl">' +
          '<button type="button" class="bid-btn bid-btn--sm bid-cell__open" tabindex="-1"></button>' +
          '<button type="button" class="bid-btn bid-btn--sm bid-cell__dlbtn" tabindex="-1"></button>' +
        '</div>' +
        '<div class="bid-cell__meta">' +
          '<span class="bid-cell__dims"></span>' +
          '<span class="bid-cell__name"></span>' +
        '</div>' +
      '</div>';
    return t;
  })();

  function dimsText(item, unknownLabel) {
    const w = item.naturalWidth || item.displayWidth || 0;
    const h = item.naturalHeight || item.displayHeight || 0;
    if (w && h) return w + '×' + h;
    return unknownLabel;
  }

  function createGrid(opts) {
    const scrollEl = opts.scrollEl;
    const sizerEl = opts.sizerEl;
    const gap = opts.gap != null ? opts.gap : 12;
    const captionH = opts.captionH != null ? opts.captionH : 31;
    const overscan = 2;

    const strings = opts.strings || {};
    const sourceLabel = opts.sourceLabel || ((s) => s);

    let items = [];
    let thumb = opts.thumbSize || 150;
    let cols = 1, cellW = thumb, cellH = thumb + captionH, rowH = cellH + gap, rows = 0;
    let padL = 0;
    let focusIndex = -1;
    const rendered = new Map(); // index -> cell element

    function measure() {
      const cs = getComputedStyle(scrollEl);
      padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      const avail = Math.max(0, scrollEl.clientWidth - padL - padR);
      cols = Math.max(1, Math.floor((avail + gap) / (thumb + gap)));
      cellW = Math.max(60, Math.floor((avail - (cols - 1) * gap) / cols));
      cellH = cellW + captionH;
      rowH = cellH + gap;
      rows = Math.ceil(items.length / cols);
      sizerEl.style.height = (rows > 0 ? rows * rowH - gap : 0) + 'px';
    }

    function positionCell(el, idx) {
      const row = Math.floor(idx / cols);
      const col = idx % cols;
      el.style.left = (col * (cellW + gap)) + 'px';
      el.style.top = (row * rowH) + 'px';
      el.style.width = cellW + 'px';
      el.style.height = cellH + 'px';
    }

    function fillCell(el, idx) {
      const item = items[idx];
      el.dataset.idx = idx;
      el.classList.toggle('is-selected', !!(opts.isSelected && opts.isSelected(item.id)));
      el.classList.toggle('is-focused', idx === focusIndex);
      el.classList.remove('is-broken');

      const check = el.querySelector('.bid-cell__check');
      check.checked = !!(opts.isSelected && opts.isSelected(item.id));
      check.setAttribute('aria-label', strings.select || 'Select');

      const src = el.querySelector('.bid-cell__source');
      src.textContent = sourceLabel(item.sourceType);

      const img = el.querySelector('.bid-cell__thumb');
      // Reset then assign so recycled cells don't flash the previous image.
      img.classList.remove('is-broken');
      img.alt = item.alt || '';
      if (img.getAttribute('src') !== item.url) img.setAttribute('src', item.url);
      img.onerror = function () { el.classList.add('is-broken'); img.classList.add('is-broken'); };

      el.querySelector('.bid-cell__broken').textContent = strings.broken || '';
      el.querySelector('.bid-cell__dims').textContent = dimsText(item, strings.sizeUnknown || '—');
      const nameEl = el.querySelector('.bid-cell__name');
      nameEl.textContent = item.filename || item.alt || item.domain || '';
      nameEl.title = item.url;

      const openBtn = el.querySelector('.bid-cell__open');
      openBtn.textContent = '↗';
      openBtn.title = strings.open || 'Open original';
      const dlBtn = el.querySelector('.bid-cell__dlbtn');
      dlBtn.textContent = '↓';
      dlBtn.title = strings.download || 'Download';

      positionCell(el, idx);
    }

    function buildCell(idx) {
      const el = CELL_TEMPLATE.content.firstElementChild.cloneNode(true);
      fillCell(el, idx);
      sizerEl.appendChild(el);
      return el;
    }

    function render() {
      if (!items.length) { clear(); return; }
      const scrollTop = scrollEl.scrollTop;
      const viewportH = scrollEl.clientHeight;
      const firstRow = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
      const lastRow = Math.min(rows - 1, Math.floor((scrollTop + viewportH) / rowH) + overscan);
      const firstIdx = firstRow * cols;
      const lastIdx = Math.min(items.length - 1, (lastRow + 1) * cols - 1);

      // Remove cells outside the window.
      for (const idx of Array.from(rendered.keys())) {
        if (idx < firstIdx || idx > lastIdx) { rendered.get(idx).remove(); rendered.delete(idx); }
      }
      // Add / refresh cells inside the window.
      for (let idx = firstIdx; idx <= lastIdx; idx++) {
        if (rendered.has(idx)) { positionCell(rendered.get(idx), idx); }
        else { rendered.set(idx, buildCell(idx)); }
      }
    }

    function clear() {
      for (const el of rendered.values()) el.remove();
      rendered.clear();
    }

    function refreshSelection() {
      for (const [idx, el] of rendered) {
        const item = items[idx];
        const sel = !!(opts.isSelected && opts.isSelected(item.id));
        el.classList.toggle('is-selected', sel);
        const check = el.querySelector('.bid-cell__check');
        if (check) check.checked = sel;
      }
    }

    function ensureVisible(idx) {
      const row = Math.floor(idx / cols);
      const top = row * rowH;
      const bottom = top + cellH;
      const viewTop = scrollEl.scrollTop;
      const viewBottom = viewTop + scrollEl.clientHeight;
      if (top < viewTop) scrollEl.scrollTop = top;
      else if (bottom > viewBottom) scrollEl.scrollTop = bottom - scrollEl.clientHeight;
    }

    function setFocus(idx, o) {
      const options = o || {};
      if (idx < 0 || idx >= items.length) return;
      const prev = focusIndex;
      focusIndex = idx;
      if (options.scroll !== false) ensureVisible(idx);
      render();
      if (rendered.has(prev)) rendered.get(prev).classList.remove('is-focused');
      if (rendered.has(idx)) rendered.get(idx).classList.add('is-focused');
      if (typeof opts.onFocusChange === 'function') opts.onFocusChange(idx);
    }

    // Event delegation on the scroll container.
    scrollEl.addEventListener('click', function (e) {
      const cell = e.target.closest('.bid-cell');
      if (!cell || !scrollEl.contains(cell)) return;
      const idx = parseInt(cell.dataset.idx, 10);
      const item = items[idx];
      if (!item) return;
      if (e.target.closest('.bid-cell__dlbtn')) { if (opts.onDownload) opts.onDownload(item, idx); return; }
      if (e.target.closest('.bid-cell__open')) { if (opts.onOpen) opts.onOpen(item, idx); return; }
      // checkbox click or anywhere else on the cell toggles selection
      if (opts.onToggle) opts.onToggle(item.id, idx);
      setFocus(idx, { scroll: false });
    });

    const onScroll = rafThrottle(render);
    scrollEl.addEventListener('scroll', onScroll, { passive: true });

    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(rafThrottle(function () { measure(); render(); }));
      ro.observe(scrollEl);
    }

    return {
      setItems(arr) { items = Array.isArray(arr) ? arr : []; focusIndex = items.length ? 0 : -1; clear(); measure(); render(); },
      setThumbSize(px) { thumb = px; measure(); render(); },
      relayout() { measure(); render(); },
      refreshSelection,
      setFocus,
      getFocus() { return focusIndex; },
      getCols() { return cols; },
      getCount() { return items.length; },
      getItemAt(i) { return items[i]; },
      destroy() { if (ro) ro.disconnect(); scrollEl.removeEventListener('scroll', onScroll); clear(); },
    };
  }

  g.BID.createGrid = createGrid;
  void escapeHtml; // reserved for future use; keep util import surface stable
})();
