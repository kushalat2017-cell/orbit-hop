// Monetize — one thin wrapper over the web-game portal SDKs that pay developers an ad-revenue share.
// Portal is picked from ?portal=crazygames|poki or the hostname. Anywhere else (GitHub Pages, itch.io)
// every call is a safe no-op, so the game runs unchanged. Check each portal's current SDK docs before submitting.
window.Monetize = (() => {
  'use strict';
  const SDK_URLS = {
    crazygames: 'https://sdk.crazygames.com/crazygames-sdk-v3.js',
    poki: 'https://game-cdn.poki.com/scripts/v2/poki-sdk.js',
  };
  let portal = 'none';
  let ready = false;
  let inGameplay = false;
  let onPause = () => {}, onResume = () => {};

  function detect() {
    const q = new URLSearchParams(location.search).get('portal');
    if (q && SDK_URLS[q]) return q;
    const h = location.hostname;
    if (h.includes('crazygames')) return 'crazygames';
    if (h.includes('poki')) return 'poki';
    return 'none';
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve; s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);

  async function init() {
    const want = detect();
    if (want === 'none') return 'none';
    try {
      await withTimeout(loadScript(SDK_URLS[want]), 5000);
      if (want === 'crazygames') await withTimeout(window.CrazyGames.SDK.init(), 5000);
      if (want === 'poki') await withTimeout(window.PokiSDK.init(), 5000);
      portal = want; ready = true;
    } catch (e) {
      portal = 'none'; ready = false;
    }
    return portal;
  }

  function loadingFinished() {
    if (!ready) return;
    try {
      if (portal === 'poki') window.PokiSDK.gameLoadingFinished();
      if (portal === 'crazygames') window.CrazyGames.SDK.game.loadingStop();
    } catch (e) {}
  }

  function gameplayStart() {
    if (!ready || inGameplay) return;
    inGameplay = true;
    try {
      if (portal === 'poki') window.PokiSDK.gameplayStart();
      if (portal === 'crazygames') window.CrazyGames.SDK.game.gameplayStart();
    } catch (e) {}
  }

  function gameplayStop() {
    if (!ready || !inGameplay) return;
    inGameplay = false;
    try {
      if (portal === 'poki') window.PokiSDK.gameplayStop();
      if (portal === 'crazygames') window.CrazyGames.SDK.game.gameplayStop();
    } catch (e) {}
  }

  // Resolves when the ad is over (or skipped). Never rejects.
  function midgame() {
    if (!ready) return Promise.resolve();
    return new Promise(resolve => {
      try {
        if (portal === 'poki') {
          window.PokiSDK.commercialBreak(() => onPause()).then(() => { onResume(); resolve(); });
        } else if (portal === 'crazygames') {
          window.CrazyGames.SDK.ad.requestAd('midgame', {
            adStarted: () => onPause(),
            adFinished: () => { onResume(); resolve(); },
            adError: () => { onResume(); resolve(); },
          });
        } else resolve();
      } catch (e) { onResume(); resolve(); }
    });
  }

  // Resolves true only if the player watched the whole rewarded ad.
  function rewarded() {
    if (!ready) return Promise.resolve(false);
    return new Promise(resolve => {
      try {
        if (portal === 'poki') {
          window.PokiSDK.rewardedBreak(() => onPause()).then(ok => { onResume(); resolve(!!ok); });
        } else if (portal === 'crazygames') {
          window.CrazyGames.SDK.ad.requestAd('rewarded', {
            adStarted: () => onPause(),
            adFinished: () => { onResume(); resolve(true); },
            adError: () => { onResume(); resolve(false); },
          });
        } else resolve(false);
      } catch (e) { onResume(); resolve(false); }
    });
  }

  return {
    init, loadingFinished, gameplayStart, gameplayStop, midgame, rewarded,
    hasRewarded: () => ready,
    get portal() { return portal; },
    onAdPause(fn) { onPause = fn; },
    onAdResume(fn) { onResume = fn; },
  };
})();
