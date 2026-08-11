// ============================================================
// js/ring-viz.js — SRM WebRing directory ring visualization
// Renders member nodes on a circle with links in ring order and
// exposes window.SRMViz (highlight/hover) plus pan & zoom.
// ============================================================
/* SRM WebRing — directory ring visualization (no dependencies).
 *
 * Renders member nodes on a circle inside #ring-viz, links consecutive members
 * (the ring order), and exposes:
 *   window.SRMViz.highlight(keys)  — dim everything, bloom the matching nodes
 *   window.SRMViz.setHover(key)    — single-node hover bloom
 *   window.SRMViz.clearHover()     — clear hover bloom
 * Keys are normalised member website URLs (see SRMData.key).
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var R = 320;
  var nodes = [];
  var links = [];
  var nodeKeys = [];
  var container = null;
  var searchKeys = [];
  var hoverKey = null;
  var svgEl = null;
  var zoom = 1;
  var panX = 400;
  var panY = 400;

  function keyOf(m) {
    return window.SRMData.key(m.website);
  }

  // ── Build the ring SVG (ghost path, links, nodes) ──
  function place(members) {
    var wrap = document.getElementById('ring-viz');
    if (!wrap || !members.length) return;
    container = document.getElementById('directory-ring');

    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'directory-ring-svg is-pannable');
    svg.setAttribute('viewBox', '0 0 800 800');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Interactive ring of member sites');
    svgEl = svg;

    var n = members.length;
    var cx = 400;
    var cy = 400;
    var radius = n > 1 ? R : 20;

    var pos = members.map(function (_, i) {
      // Start at -90° so node 0 sits at the top of the ring.
      var a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) };
    });

    // Ghost ring path
    if (n > 1) {
      var ghost = document.createElementNS(NS, 'circle');
      ghost.setAttribute('cx', cx);
      ghost.setAttribute('cy', cy);
      ghost.setAttribute('r', radius);
      ghost.setAttribute('class', 'ring-ghost-path');
      svg.appendChild(ghost);
    }

    // Ring links (consecutive members, closing the loop)
    var linksGroup = document.createElementNS(NS, 'g');
    if (n > 1) {
      for (var i = 0; i < n; i++) {
        var a = pos[i];
        var b = pos[(i + 1) % n];
        var line = document.createElementNS(NS, 'line');
        line.setAttribute('x1', a.x);
        line.setAttribute('y1', a.y);
        line.setAttribute('x2', b.x);
        line.setAttribute('y2', b.y);
        line.setAttribute('class', 'ring-link-line');
        linksGroup.appendChild(line);
        links.push(line);
      }
    }
    svg.appendChild(linksGroup);

    // Nodes
    members.forEach(function (m, i) {
      var g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'ring-node');
      g.setAttribute('data-key', keyOf(m));

      var link = document.createElementNS(NS, 'a');
      link.setAttribute('href', m.website);
      link.setAttribute('target', '_blank');
      link.setAttribute('rel', 'noopener noreferrer');

      var dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('class', 'ring-node-dot');
      dot.setAttribute('cx', pos[i].x);
      dot.setAttribute('cy', pos[i].y);
      dot.setAttribute('r', 6);

      var hit = document.createElementNS(NS, 'circle');
      hit.setAttribute('class', 'ring-node-hit');
      hit.setAttribute('cx', pos[i].x);
      hit.setAttribute('cy', pos[i].y);
      hit.setAttribute('r', 30);
      hit.setAttribute('fill', 'transparent');

      var label = document.createElementNS(NS, 'text');
      label.setAttribute('class', 'ring-node-label');
      label.setAttribute('x', pos[i].x);
      // Alternate labels above/below the ring to stop neighbours colliding.
      label.setAttribute('y', pos[i].y + (i % 2 === 0 ? 30 : -20));
      label.textContent = m.name || '';

      var title = document.createElementNS(NS, 'title');
      title.textContent = (m.name || '') + (m.location ? ' — ' + m.location : '');

      link.appendChild(dot);
      link.appendChild(hit);
      link.appendChild(label);
      link.appendChild(title);
      g.appendChild(link);
      svg.appendChild(g);

      nodes.push(g);
      nodeKeys.push(keyOf(m));
    });

    wrap.appendChild(svg);
    setupPanZoom();
  }

  // ── Pan / zoom (drag to pan, +/− to zoom, reset button) ──
  var MIN_ZOOM = 1;
  var MAX_ZOOM = 8;

  function clampPan() {
    var half = 400 / zoom;
    panX = Math.max(half, Math.min(800 - half, panX));
    panY = Math.max(half, Math.min(800 - half, panY));
  }

  function applyView() {
    if (!svgEl) return;
    var half = 400 / zoom;
    svgEl.setAttribute(
      'viewBox',
      (panX - half) + ' ' + (panY - half) + ' ' + (800 / zoom) + ' ' + (800 / zoom)
    );
  }

  function zoomBy(factor) {
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * factor));
    clampPan();
    applyView();
  }

  function resetView() {
    zoom = 1;
    panX = 400;
    panY = 400;
    applyView();
  }

  function setupPanZoom() {
    if (!svgEl) return;
    var dragging = false;
    var dragMoved = false;
    var startX = 0;
    var startY = 0;
    var startPanX = 0;
    var startPanY = 0;

    svgEl.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      dragging = true;
      dragMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      startPanX = panX;
      startPanY = panY;
      svgEl.classList.add('is-panning');
      try { svgEl.setPointerCapture(e.pointerId); } catch (err) {}
    });

    svgEl.addEventListener('pointermove', function (e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!dragMoved && Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
      var rect = svgEl.getBoundingClientRect();
      if (!rect.width) return;
      panX = startPanX - (dx * (800 / zoom)) / rect.width;
      panY = startPanY - (dy * (800 / zoom)) / rect.height;
      clampPan();
      applyView();
    });

    function endDrag() {
      if (!dragging) return;
      dragging = false;
      svgEl.classList.remove('is-panning');
    }

    svgEl.addEventListener('pointerup', endDrag);
    svgEl.addEventListener('pointercancel', endDrag);

    // A drag must not trigger the node links underneath
    svgEl.addEventListener('click', function (e) {
      if (dragMoved) {
        e.preventDefault();
        dragMoved = false;
      }
    });

    // On mobile the carousel listens for touch to rotate panels; keep those
    // touches away when interacting with the map.
    if (window.matchMedia && window.matchMedia('(max-width: 767px)').matches) {
      svgEl.addEventListener('touchmove', function (e) {
        e.stopPropagation();
        e.preventDefault();
      }, { passive: false });
    }

    var zoomIn = document.getElementById('ring-zoom-in');
    var zoomOut = document.getElementById('ring-zoom-out');
    var zoomReset = document.getElementById('ring-zoom-reset');

    if (zoomIn) zoomIn.addEventListener('click', function () { zoomBy(1.5); });
    if (zoomOut) zoomOut.addEventListener('click', function () { zoomBy(1 / 1.5); });
    if (zoomReset) zoomReset.addEventListener('click', resetView);
  }

  // ── Highlight state → node/link classes ──
  function apply() {
    if (!container) return;
    var keys = searchKeys.length ? searchKeys : (hoverKey ? [hoverKey] : []);

    container.classList.toggle('has-highlight', keys.length > 0);

    nodes.forEach(function (g, i) {
      g.classList.toggle('is-highlighted', keys.indexOf(nodeKeys[i]) !== -1);
    });

    links.forEach(function (line, i) {
      var a = keys.indexOf(nodeKeys[i]) !== -1;
      var b = keys.indexOf(nodeKeys[(i + 1) % nodeKeys.length]) !== -1;
      line.classList.toggle('is-highlighted', a || b);
    });
  }

  function highlight(keys) {
    searchKeys = keys || [];
    apply();
  }

  function setHover(key) {
    hoverKey = key || null;
    apply();
  }

  function clearHover() {
    hoverKey = null;
    apply();
  }

  // ── Public API (consumed by js/directory.js) ──
  window.SRMViz = {
    highlight: highlight,
    setHover: setHover,
    clearHover: clearHover
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      window.SRMData.load().then(place);
    });
  } else {
    window.SRMData.load().then(place);
  }
})();
