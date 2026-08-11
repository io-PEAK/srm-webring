// ============================================================
// js/splash-map.js — SRM WebRing splash map
// Projects each member's location onto the India SVG and draws
// animated dots plus dashed routes between consecutive members.
// ============================================================
/* SRM WebRing — splash map (India) with animated ring.
 *
 * Reads the member list via SRMData, projects each member's lat/lng into the
 * India SVG viewBox (0 0 1000 1100) using an equirectangular projection, and
 * appends animated dots + dashed ring lines between consecutive members in the
 * ring rotation.
 *
 * Expected element: <svg class="splash-map"> already inlined with the India
 * map markup. Appends: <circle class="anim-dot"> dots and <path class="anim-line">
 * curves. City text is NOT shown on the map (matches the webring.ca reference).
 */
(function () {
  'use strict';

  // India bounding box: 6.5N–37.5N, 68E–97.6E (full country incl. islands)
  // SVG viewBox: 0 0 1000 1100.
  var LAT_MIN = 6.5;
  var LAT_MAX = 37.5;
  var LNG_MIN = 68;
  var LNG_MAX = 97.6;
  var VB_W = 1000;
  var VB_H = 1100;

  // City coords from data/cities.json (name -> { lat, lng, name, state }),
  // generated once via scripts/geocode-cities.js (Nominatim).
  // Common alternate spellings kept here so legacy locations still resolve.
  var ALIASES = {
    'new delhi': 'delhi',
    'gurugram': 'gurgaon',
    'bangalore': 'bengaluru',
    'prayagraj': 'allahabad'
  };
  var CITY_COORDS = null;
  var FALLBACK = { lat: 28.6139, lng: 77.2090 }; // Delhi

  // ── Data loading (members + city coordinates) ──
  function loadCities() {
    if (CITY_COORDS) return Promise.resolve(CITY_COORDS);
    return fetch('data/cities.json')
      .then(function (r) { return r.json(); })
      .then(function (data) { CITY_COORDS = data || {}; return CITY_COORDS; })
      .catch(function () { CITY_COORDS = {}; return CITY_COORDS; });
  }

  function project(lat, lng) {
    var x = ((lng - LNG_MIN) / (LNG_MAX - LNG_MIN)) * VB_W;
    var y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * VB_H;
    return { x: x, y: y };
  }

  function lookupCoords(member, cities) {
    if (typeof member.lat === 'number' && typeof member.lng === 'number') {
      return { lat: member.lat, lng: member.lng };
    }
    var loc = (member.location || member.city || '').toLowerCase().trim();
    var entry = cities[loc];
    if (!entry && loc) entry = cities[ALIASES[loc]];
    if (entry) return { lat: entry.lat, lng: entry.lng };
    return FALLBACK;
  }

  function fetchMembers() {
    return window.SRMData ? window.SRMData.load() : Promise.resolve([]);
  }

  function memberKey(m) {
    return (m.website || m.name || '').replace(/\/$/, '');
  }

  // Curved route between two projected points — arc that bows northward
  // (smaller y in our inverted-projection space) so routes look like arcs
  // drawn on a flat map.
  function arcPath(a, b) {
    var mx = (a.x + b.x) / 2;
    var my = (a.y + b.y) / 2;
    var dx = b.x - a.x;
    var dy = b.y - a.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    // Perpendicular offset, bowed upward (negative y).
    var offset = Math.min(len * 0.35, 140);
    var cx = mx - (dy / len) * offset;
    var cy = my + (Math.abs(dx) / len) * offset;
    return 'M ' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) +
           ' Q ' + cx.toFixed(1) + ' ' + cy.toFixed(1) +
           ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1);
  }

  // ── Render: routes then member dots ──
  function render(svg, members, cities) {
    var NS = 'http://www.w3.org/2000/svg';
    var activeMembers = members.filter(function (m) { return !m.hidden && !m.unreachableSince; });

    // Expose the active ring rotation globally so the prev/next arrows can use it.
    var ring = activeMembers.slice();
    window.__SRM_RING_ROTATION = ring;

    // Project each member.
    var pts = ring.map(function (m) {
      var c = lookupCoords(m, cities);
      return { m: m, p: project(c.lat, c.lng) };
    });

    // Draw routes between consecutive members, plus a final route closing
    // the loop back to the first member. Each line draws in sequentially
    // (ring order) and then keeps marching once drawn.
    var LINE_STAGGER = 450;
    var LINE_DRAW_MS = 800;
    if (pts.length > 1) {
      var routesGroup = document.createElementNS(NS, 'g');
      routesGroup.setAttribute('class', 'india-routes');
      svg.appendChild(routesGroup);

      for (var i = 0; i < pts.length; i++) {
        var a = pts[i].p;
        var b = pts[(i + 1) % pts.length].p;
        var path = document.createElementNS(NS, 'path');
        path.setAttribute('d', arcPath(a, b));
        path.setAttribute('class', 'anim-line anim-line-' + i);
        path.style.animationDelay = (i * LINE_STAGGER) + 'ms, ' + ((i * LINE_STAGGER) + LINE_DRAW_MS) + 'ms';
        routesGroup.appendChild(path);
      }
    }

    // Draw member dots, staggered in like webring.ca's city markers.
    var DOT_STAGGER = 700;
    pts.forEach(function (entry, i) {
      var p = entry.p;
      var circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', p.x.toFixed(1));
      circle.setAttribute('cy', p.y.toFixed(1));
      circle.setAttribute('r', '8');
      circle.setAttribute('class', 'anim-dot anim-dot-' + i);
      circle.style.animationDelay = (i * DOT_STAGGER) + 'ms, ' + ((i * DOT_STAGGER) + 500) + 'ms';
      var title = (entry.m.name || '') + (entry.m.location ? ' — ' + entry.m.location : '');
      circle.setAttribute('aria-label', title);
      var t = document.createElementNS(NS, 'title');
      t.textContent = title;
      circle.appendChild(t);
      svg.appendChild(circle);
    });
  }

  function init() {
    var svg = document.querySelector('.splash-map');
    if (!svg) return;
    Promise.all([fetchMembers(), loadCities()])
      .then(function (results) { render(svg, results[0], results[1]); })
      .catch(function (err) {
        console.warn('[splash-map] Could not load members or cities:', err);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();