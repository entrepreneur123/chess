/*
 * Boot guard (classic script, runs before the app module). If the app never replaces the static
 * boot splash, the player must never be left on an endless loading screen:
 *  - the app's own module script fails to load (e.g. a stale page after a deploy, or a network
 *    error): reload once automatically, then show a retry button;
 *  - the app has not started after BOOT_TIMEOUT_MS: show a retry button (no forced reload).
 * External file because the CSP forbids inline scripts. Plain ES5, no dependencies.
 */
(function () {
  var BOOT_TIMEOUT_MS = 12000;
  var RETRY_KEY = 'gc-boot-retry';

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
      location.reload();
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
      if (!retried) location.reload();
      else showRetry();
    },
    true
  );

  window.setTimeout(function () {
    if (splash()) showRetry();
    else {
      try {
        sessionStorage.removeItem(RETRY_KEY);
      } catch (_) {
        /* ignore */
      }
    }
  }, BOOT_TIMEOUT_MS);
})();
