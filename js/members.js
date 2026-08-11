// ============================================================
// js/members.js — SRM WebRing shared member loader
// Fetches the active member list from the backend worker with a
// data/members.json fallback and exposes it to every panel as
// window.SRMData.load().
// ============================================================
/* SRM WebRing — shared member loader.
 *
 * Fetches the active member list once from /api/members (Cloudflare Worker)
 * with a data/members.json fallback, caches the promise, and exposes it as
 * window.SRMData.load() for the splash map, directory, and ring viz.
 */
window.SRMData = (function () {
  'use strict';

  var cache = null;

  // ── Fetch members once (cached promise) ──
  function load() {
    if (cache) return cache;
    cache = fetch('/api/members', { credentials: 'omit' })
      .then(function (r) {
        if (!r.ok) throw new Error('API ' + r.status);
        return r.json();
      })
      .catch(function () {
        return fetch('data/members.json').then(function (r) { return r.json(); });
      })
      .then(function (members) {
        // Drop hidden/unreachable members so every panel shows the active ring only.
        return (members || []).filter(function (m) { return !m.hidden && !m.unreachableSince; });
      })
      .catch(function () { return []; });
    return cache;
  }

  // ── URL helpers used across panels ──
  function hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch (e) { return url; }
  }

  // Normalised key used to correlate members across panels (trailing slash stripped)
  function key(url) {
    return String(url || '').replace(/\/$/, '');
  }

  return { load: load, hostname: hostname, key: key };
})();
