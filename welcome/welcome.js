/**
 * welcome/welcome.js — first-run controller. Handles the one-time analytics opt-in ask and
 * closing the welcome tab. BID.* shared modules loaded first.
 */
(function () {
  'use strict';
  const t = BID.i18n.t;
  const $ = (id) => document.getElementById(id);

  async function boot() {
    await BID.analytics._hydrate();

    // If the user already answered (e.g. reopened welcome), reflect that.
    if (BID.analytics.wasAsked()) showAck(BID.analytics.isOptedIn());

    $('analyticsYes').addEventListener('click', async () => { await BID.analytics.setOptIn(true); showAck(true); });
    $('analyticsNo').addEventListener('click', async () => { await BID.analytics.setOptIn(false); showAck(false); });

    $('getStarted').addEventListener('click', closeSelf);
  }

  function showAck(optedIn) {
    $('analyticsYes').disabled = true;
    $('analyticsNo').disabled = true;
    const ack = $('analyticsAckChoice');
    ack.hidden = false;
    ack.textContent = optedIn ? t('optionsAnalyticsToggle') + ' ✓' : t('analyticsPromptNo') + ' ✓';
  }

  function closeSelf() {
    try {
      chrome.tabs.getCurrent((tab) => {
        if (tab && tab.id != null) chrome.tabs.remove(tab.id);
        else window.close();
      });
    } catch (_) { window.close(); }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
