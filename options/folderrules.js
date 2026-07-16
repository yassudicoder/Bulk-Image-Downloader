/**
 * options/folderrules.js — the Folder Rules editor on the options page.
 * Renders/edits an ordered list of routing rules and persists them to
 * chrome.storage.local[STORAGE.folderRules]. The results page reads the same store and
 * applies BID.folderRules.route() to each download. Depends on BID.{constants,i18n,folderRules}.
 */
(function () {
  'use strict';
  const { STORAGE } = BID.constants;
  const t = BID.i18n.t;
  const FR = BID.folderRules;

  const CONDITION_LABELS = {
    domainContains: 'frCondDomainContains',
    domainIs: 'frCondDomainIs',
    minWidth: 'frCondMinWidth',
    minHeight: 'frCondMinHeight',
    fileType: 'frCondFileType',
  };

  let rules = [];
  let saveTimer = null;
  let container, testUrlEl, testResultEl, savedEl;

  function el(tag, cls, attrs) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (const k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }

  let seq = 0;
  function uid() { return 'r' + (Date.now().toString(36)) + (seq++); }

  function newRule() {
    return { id: uid(), name: t('frNewRuleName'), enabled: true, conditions: [], template: '{domain}/{name}' };
  }

  async function load() {
    try { const g = await chrome.storage.local.get(STORAGE.folderRules); rules = g[STORAGE.folderRules] || []; }
    catch (_) { rules = []; }
    if (!Array.isArray(rules)) rules = [];
  }

  function persist() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      try { await chrome.storage.local.set({ [STORAGE.folderRules]: rules }); flashSaved(); } catch (_) {}
    }, 300);
  }
  function flashSaved() {
    if (!savedEl) return;
    savedEl.hidden = false;
    setTimeout(() => { savedEl.hidden = true; }, 1200);
  }

  // Sample metadata from the test URL (+ a nominal size so minWidth rules can be exercised).
  function sampleMeta() {
    let domain = 'unsplash.com', filename = 'mountain-lake.jpg', ext = 'jpg';
    const raw = (testUrlEl && testUrlEl.value.trim());
    if (raw) {
      try {
        const u = new URL(raw);
        domain = u.hostname;
        filename = decodeURIComponent(u.pathname).split('/').pop() || 'image';
        const dot = filename.lastIndexOf('.');
        ext = dot > 0 ? filename.slice(dot + 1).toLowerCase() : '';
      } catch (_) { /* leave defaults */ }
    }
    return { domain, filename, ext, naturalWidth: 1920, naturalHeight: 1080, index: 0, date: new Date() };
  }

  function updateTest() {
    if (!testResultEl) return;
    const meta = sampleMeta();
    const folder = FR.route(meta, rules);
    testResultEl.textContent = 'Downloads/' + (folder ? folder + '/' : '') + (meta.filename || 'image');
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= rules.length) return;
    const tmp = rules[i]; rules[i] = rules[j]; rules[j] = tmp;
    persist(); render();
  }

  function iconBtn(glyph, label, onClick, extraCls) {
    const b = el('button', 'bid-btn bid-btn--ghost bid-btn--sm bid-fr__icon' + (extraCls ? ' ' + extraCls : ''), { type: 'button' });
    b.textContent = glyph;
    b.setAttribute('aria-label', label); b.title = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function condPlaceholder(input, type) {
    const numeric = (type === 'minWidth' || type === 'minHeight');
    input.type = numeric ? 'number' : 'text';
    input.placeholder = numeric ? '1920' : (type === 'fileType' ? 'jpg' : 'example.com');
  }

  function renderCondition(rule, c, ci) {
    const row = el('div', 'bid-fr__cond');
    const type = el('select', 'bid-select');
    FR.CONDITION_TYPES.forEach((ct) => {
      const o = document.createElement('option');
      o.value = ct; o.textContent = t(CONDITION_LABELS[ct] || ct);
      type.appendChild(o);
    });
    type.value = c.type;
    const value = el('input', 'bid-input', { type: 'text' });
    value.value = (c.value != null) ? c.value : '';
    condPlaceholder(value, c.type);
    type.addEventListener('change', () => { c.type = type.value; condPlaceholder(value, c.type); persist(); updateTest(); });
    value.addEventListener('input', () => { c.value = value.value; persist(); updateTest(); });
    const rm = iconBtn('✕', t('frRemoveCondition'), () => { rule.conditions.splice(ci, 1); persist(); render(); });
    row.append(type, value, rm);
    return row;
  }

  function insertToken(input, tok) {
    const start = (input.selectionStart != null) ? input.selectionStart : input.value.length;
    const end = (input.selectionEnd != null) ? input.selectionEnd : input.value.length;
    input.value = input.value.slice(0, start) + tok + input.value.slice(end);
    const pos = start + tok.length;
    input.focus();
    try { input.setSelectionRange(pos, pos); } catch (_) {}
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function renderRule(rule, index) {
    const card = el('div', 'bid-fr__rule');

    // Header: enable, name, reorder, delete
    const head = el('div', 'bid-fr__rulehead');
    const enable = el('input', null, { type: 'checkbox' });
    enable.checked = rule.enabled !== false;
    enable.setAttribute('aria-label', t('frEnableRule')); enable.title = t('frEnableRule');
    enable.addEventListener('change', () => { rule.enabled = enable.checked; persist(); updateTest(); });
    const name = el('input', 'bid-input bid-fr__name', { type: 'text' });
    name.value = rule.name || ''; name.placeholder = t('frNewRuleName');
    name.addEventListener('input', () => { rule.name = name.value; persist(); });
    head.append(enable, name,
      iconBtn('↑', t('frMoveUp'), () => move(index, -1)),
      iconBtn('↓', t('frMoveDown'), () => move(index, 1)),
      iconBtn('✕', t('frDeleteRule'), () => { rules.splice(index, 1); persist(); render(); }, 'bid-fr__del'));

    // Conditions (ANDed)
    const conds = el('div', 'bid-fr__conds');
    const condLabel = el('div', 'bid-fr__sublabel'); condLabel.textContent = t('frIf');
    conds.appendChild(condLabel);
    if (!rule.conditions || !rule.conditions.length) {
      const anyHint = el('p', 'bid-hint'); anyHint.textContent = t('frAppliesToAll');
      conds.appendChild(anyHint);
    } else {
      rule.conditions.forEach((c, ci) => conds.appendChild(renderCondition(rule, c, ci)));
    }
    const addCond = el('button', 'bid-btn bid-btn--ghost bid-btn--sm', { type: 'button' });
    addCond.textContent = t('frAddCondition');
    addCond.addEventListener('click', () => {
      rule.conditions = rule.conditions || [];
      rule.conditions.push({ type: 'domainContains', value: '' });
      persist(); render();
    });
    conds.appendChild(addCond);

    // Template + token chips + preview
    const tmplWrap = el('div', 'bid-fr__tmpl');
    const tmplLabel = el('div', 'bid-fr__sublabel'); tmplLabel.textContent = t('frSaveTo');
    const tmpl = el('input', 'bid-input bid-mono', { type: 'text' });
    tmpl.value = rule.template || ''; tmpl.placeholder = '{domain}/{yyyy-mm-dd}/{name}';
    const preview = el('p', 'bid-hint bid-fr__preview');
    const refreshPreview = () => {
      const folder = FR.expand(rule.template || '', sampleMeta());
      preview.textContent = t('frPreviewPrefix') + ' Downloads/' + (folder ? folder + '/' : '') + '…';
    };
    tmpl.addEventListener('input', () => { rule.template = tmpl.value; persist(); refreshPreview(); updateTest(); });
    const tokens = el('div', 'bid-fr__tokens');
    FR.TOKENS.forEach((tok) => {
      const chip = el('button', 'bid-fr__token', { type: 'button' });
      chip.textContent = tok;
      chip.addEventListener('click', () => insertToken(tmpl, tok));
      tokens.appendChild(chip);
    });
    refreshPreview();
    tmplWrap.append(tmplLabel, tmpl, tokens, preview);

    card.append(head, conds, tmplWrap);
    return card;
  }

  function render() {
    if (!container) return;
    container.textContent = '';
    if (!rules.length) {
      const empty = el('p', 'bid-hint'); empty.textContent = t('frEmpty');
      container.appendChild(empty);
    } else {
      rules.forEach((rule, i) => container.appendChild(renderRule(rule, i)));
    }
    updateTest();
  }

  async function boot() {
    container = document.getElementById('folderRulesEditor');
    if (!container) return; // section not on this page
    testUrlEl = document.getElementById('frTestUrl');
    testResultEl = document.getElementById('frTestResult');
    savedEl = document.getElementById('frSaved');

    await load();
    render();

    const add = document.getElementById('frAddRule');
    if (add) add.addEventListener('click', () => { rules.push(newRule()); persist(); render(); });
    if (testUrlEl) testUrlEl.addEventListener('input', updateTest);

    // Flush a pending debounced save if the page is navigated away (e.g. Back to results).
    window.addEventListener('pagehide', () => {
      if (!saveTimer) return;
      clearTimeout(saveTimer); saveTimer = null;
      try { chrome.storage.local.set({ [STORAGE.folderRules]: rules }); } catch (_) {}
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
