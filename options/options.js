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

  async function saveSettings(patch) {
    settings = Object.assign({}, settings, patch);
    try { await chrome.storage.local.set({ [STORAGE.settings]: settings }); flashSaved(); } catch (_) {}
  }

  async function boot() {
    await BID.analytics._hydrate();
    try { const s = await chrome.storage.local.get(STORAGE.settings); settings = s[STORAGE.settings] || {}; } catch (_) { settings = {}; }

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

    BID.analytics.capture(BID.analytics.EVENTS.OPTIONS_OPENED);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
