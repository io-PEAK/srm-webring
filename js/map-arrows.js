// ============================================================
// js/map-arrows.js — SRM WebRing splash arrows
// The tree/arrow widget on the splash map jumps to a random member
// site in a new tab, matching the original webring widget behaviour.
// ============================================================
/* Splash widget arrows (← tree →): jump to a member site on each click.
 * The centre tree acts as the webring "home" mark and also opens a random
 * member site, matching how the original webring widget behaves.
 */
(function () {
  'use strict';

  // ── Random member picker ──
  function pickRandom(members) {
    if (!members || !members.length) return null;
    return members[Math.floor(Math.random() * members.length)];
  }

  function go(members) {
    var m = pickRandom(members);
    // Empty ring: send visitors to the join page instead of a dead click.
    if (!m || !m.website) {
      window.location.href = 'join.html';
      return;
    }
    // Open member sites in a new tab so the hub stays available.
    window.open(m.website, '_blank', 'noopener,noreferrer');
  }

  // ── Init: wire the widget arrows ──
  function init() {
    var prev = document.querySelector('.map-arrow-prev');
    var next = document.querySelector('.map-arrow-next');
    var rand = document.querySelector('.map-arrow-random');
    if (!prev && !next && !rand) return;

    window.SRMData.load().then(function (members) {
      if (prev) prev.addEventListener('click', function (e) { e.preventDefault(); go(members); });
      if (next) next.addEventListener('click', function (e) { e.preventDefault(); go(members); });
      if (rand) rand.addEventListener('click', function (e) { e.preventDefault(); go(members); });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
