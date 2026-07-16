/**
 * options/options.js — settings controller. BID.* shared modules loaded first.
 * Functional in M1: analytics opt-in, dedupe threshold (stored for M2), locale preference,
 * thumbnail size (shared with results). History/folder-rules controls are disabled scaffolds.
 */
(function () {
  'use strict';
  const { STORAGE, DEFAULTS } = BID.constants;
  const t = BID.i18n.t;
  const $ = (id) => document.getElementById(id);

  let settings = {};
  let savedTimer = null;

  function flashSaved() {
    const el = $('savedToast');
    el.hidden = false;
    if (savedTimer) clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.hidden = true; }, 1400);
  }

  function setSegActive(seg, value) {
    seg.querySelectorAll('.bid-seg__btn').forEach((b) => {
      const on = b.getAttribute('data-theme-value') === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.tabIndex = on ? 0 : -1; // roving tabindex: the selected radio is the group's tab stop
    });
  }

  async function saveSettings(patch) {
    settings = Object.assign({}, settings, patch);
    try { await chrome.storage.local.set({ [STORAGE.settings]: settings }); flashSaved(); } catch (_) {}
  }

  // Settings sections as an ARIA tablist (General / Folders / History / Advanced).
  function setupSettingsTabs() {
    const tabs = Array.from(document.querySelectorAll('.bid-settings__tab'));
    if (!tabs.length) return;
    const panels = tabs.map((tb) => document.getElementById(tb.getAttribute('aria-controls')));

    function activate(name, focus) {
      tabs.forEach((tb, i) => {
        const on = tb.dataset.tab === name;
        tb.classList.toggle('is-active', on);
        tb.setAttribute('aria-selected', on ? 'true' : 'false');
        tb.tabIndex = on ? 0 : -1;
        if (panels[i]) panels[i].hidden = !on;
        if (on && focus) tb.focus();
      });
      try { history.replaceState(null, '', '#' + name); } catch (_) {}
    }

    tabs.forEach((tb) => tb.addEventListener('click', () => activate(tb.dataset.tab, false)));

    const nav = document.querySelector('.bid-settings__nav');
    if (nav) nav.addEventListener('keydown', (e) => {
      const idx = tabs.indexOf(document.activeElement);
      if (idx < 0) return;
      let next = -1;
      switch (e.key) {
        case 'ArrowDown': case 'ArrowRight': next = (idx + 1) % tabs.length; break;
        case 'ArrowUp': case 'ArrowLeft': next = (idx - 1 + tabs.length) % tabs.length; break;
        case 'Home': next = 0; break;
        case 'End': next = tabs.length - 1; break;
        default: return;
      }
      e.preventDefault();
      activate(tabs[next].dataset.tab, true);
    });

    // Deep-link: ?tab=rules or #rules jumps straight to a section.
    const qtab = new URLSearchParams(location.search).get('tab');
    const hash = (location.hash || '').replace('#', '');
    const wanted = qtab || hash;
    const initial = tabs.find((tb) => tb.dataset.tab === wanted);
    activate(initial ? initial.dataset.tab : 'general', false);
  }

  async function boot() {
    await BID.analytics._hydrate();
    try { const s = await chrome.storage.local.get(STORAGE.settings); settings = s[STORAGE.settings] || {}; } catch (_) { settings = {}; }

    setupSettingsTabs();

    // Single-tab UX: when Settings was opened from a scan, offer a way back to it.
    const scanParam = new URLSearchParams(location.search).get('scan');
    if (scanParam) {
      const back = $('backToResults');
      back.hidden = false;
      back.addEventListener('click', () => {
        location.href = chrome.runtime.getURL('results/results.html') + '?scan=' + encodeURIComponent(scanParam);
      });
    }

    // Dedupe threshold
    const thr = $('dedupeThreshold');
    const thrVal = $('dedupeThresholdVal');
    const initialThr = (settings.dedupeHammingThreshold != null) ? settings.dedupeHammingThreshold : DEFAULTS.dedupeHammingThreshold;
    thr.value = initialThr; thrVal.textContent = String(initialThr);
    thr.addEventListener('input', () => { thrVal.textContent = thr.value; });
    thr.addEventListener('change', () => saveSettings({ dedupeHammingThreshold: parseInt(thr.value, 10) }));

    // Analytics toggle (reflects the real opt-in state)
    const toggle = $('analyticsToggle');
    toggle.checked = BID.analytics.isOptedIn();
    toggle.addEventListener('change', async () => {
      await BID.analytics.setOptIn(toggle.checked);
      flashSaved();
    });

    // Locale preference (stored; applied where the runtime supports it)
    const locale = $('locale');
    locale.value = settings.locale || '';
    locale.addEventListener('change', () => saveSettings({ locale: locale.value }));

    // Theme (Appearance) — stored via BID.theme (localStorage), independent of settings.
    const themeSeg = $('themeSeg');
    const themeBtns = Array.from(themeSeg.querySelectorAll('.bid-seg__btn'));
    setSegActive(themeSeg, BID.theme.get());

    function selectTheme(v, focus) {
      BID.theme.set(v);
      setSegActive(themeSeg, v);
      flashSaved();
      if (focus) {
        const btn = themeBtns.find((b) => b.getAttribute('data-theme-value') === v);
        if (btn) btn.focus();
      }
    }

    themeBtns.forEach((btn) => {
      btn.addEventListener('click', () => selectTheme(btn.getAttribute('data-theme-value'), false));
    });

    // ARIA radio-group keyboard pattern: arrows / Home / End move and select, focus follows.
    themeSeg.addEventListener('keydown', (e) => {
      const idx = themeBtns.indexOf(document.activeElement);
      if (idx === -1) return;
      let next = -1;
      switch (e.key) {
        case 'ArrowRight': case 'ArrowDown': next = (idx + 1) % themeBtns.length; break;
        case 'ArrowLeft': case 'ArrowUp': next = (idx - 1 + themeBtns.length) % themeBtns.length; break;
        case 'Home': next = 0; break;
        case 'End': next = themeBtns.length - 1; break;
        default: return;
      }
      e.preventDefault();
      selectTheme(themeBtns[next].getAttribute('data-theme-value'), true);
    });

    // Keep the control in sync if the theme is changed from another page/context (bid:theme).
    try {
      window.addEventListener('storage', (ev) => {
        if (ev.key === 'bid:theme') setSegActive(themeSeg, BID.theme.get());
      });
    } catch (_) {}

    BID.analytics.capture(BID.analytics.EVENTS.OPTIONS_OPENED);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
