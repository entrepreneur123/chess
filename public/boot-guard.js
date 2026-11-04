/*
 * Boot guard (classic script, runs before the app module). If the app never replaces the static
 * boot splash, the player must never be left on an endless loading screen:
 *  - the app's own module script fails to load (e.g. a stale page after a deploy, or a network
 *    error): reload once automatically, then show a retry button;
 *  - the app has not started after BOOT_TIMEOUT_MS: if its main chunk did download (so start-up is
 *    stuck, not slow) reload once with a cache-busting query, otherwise show a retry button.
 * External file because the CSP forbids inline scripts. Plain ES5, no dependencies.
 */
(function () {
  var BOOT_TIMEOUT_MS = 12000;
  var RETRY_KEY = 'gc-boot-retry';
  var BUST = '_r';

  // A deploy removes the previous build's hashed files at once. A page that got a stale cached
  // index.html (the CDN can serve one for a few seconds after a deploy) then asks for a main chunk
  // that no longer exists. Reloading with a unique query string misses every cache and fetches the
  // current index.html. The marker is stripped again here so the address bar stays clean.
  function freshReload() {
    var u = location.pathname + '?' + BUST + '=' + Date.now() + location.hash;
    location.replace(u);
  }
  try {
    if (location.search.indexOf(BUST + '=') !== -1 && history.replaceState) {
      history.replaceState(history.state, '', location.pathname + location.hash);
    }
  } catch (_) {
    /* ignore */
  }

  function splash() {
    var app = document.getElementById('app');
    return app ? app.querySelector('.boot') : null;
  }

  function showRetry() {
    var s = splash();
    if (!s || s.querySelector('.boot__retry')) return;
    var p = document.createElement('p');
    p.className = 'boot__sub boot__note';
    p.textContent = '불러오기가 늦어지고 있어요';
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'boot__retry';
    b.textContent = '다시 시도';
    b.addEventListener('click', function () {
      freshReload();
    });
    s.appendChild(p);
    s.appendChild(b);
  }

  // A failed <script> load fires a non-bubbling error event: listen in the capture phase.
  window.addEventListener(
    'error',
    function (e) {
      var t = e && e.target;
      if (!t || t.tagName !== 'SCRIPT' || !splash()) return;
      var retried = false;
      try {
        retried = sessionStorage.getItem(RETRY_KEY) === '1';
        if (!retried) sessionStorage.setItem(RETRY_KEY, '1');
      } catch (_) {
        retried = true; // no storage: never risk a reload loop
      }
      if (!retried) freshReload();
      else showRetry();
    },
    true
  );

  // The app's main chunk finished downloading (Resource Timing), so a still-visible splash means
  // the start-up is stuck rather than slow: one automatic fresh reload is worth it. On a slow
  // network (chunk still downloading) never reload: that would restart the download.
  function mainChunkLoaded() {
    try {
      var list = performance.getEntriesByType('resource');
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        if (/\/assets\/main-[^/]+\.js/.test(e.name) && e.responseEnd > 0) return true;
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  window.setTimeout(function () {
    if (splash()) {
      var retried = true;
      try {
        retried = sessionStorage.getItem(RETRY_KEY) === '1';
        if (!retried && mainChunkLoaded()) sessionStorage.setItem(RETRY_KEY, '1');
      } catch (_) {
        retried = true;
      }
      if (!retried && mainChunkLoaded()) freshReload();
      else showRetry();
    } else {
      try {
        sessionStorage.removeItem(RETRY_KEY);
      } catch (_) {
        /* ignore */
      }
    }
  }, BOOT_TIMEOUT_MS);
})();
