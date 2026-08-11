// ============================================================
// js/splash.js — SRM WebRing 3D cylinder carousel
// Drives the ring of panels (wheel/touch/keyboard/snap-to) and
// emits panelchange/panelsettle/panelunsettle events that the
// other panels listen for.
// ============================================================
/* SRM WebRing — 3D cylinder carousel driver.
 *
 * Adapted from webring.ca's public/splash.js: a continuous-angle cylinder
 * carousel driven by wheel / touch / arrow-key input. Each <section class="panel">
 * inside .ring-track is placed on the cylinder with rotateY() translateZ() and
 * the track sits at translateZ(-radius) so panels face the camera.
 *
 * Fires CustomEvents:
 *   'panelchange'  — { index } as the active index changes
 *   'panelsettle'  — { index } when the track stops moving
 *   'panelunsettle'— when the track starts moving
 *   'snapto'       — { index } request a programmatic snap
 */
(function () {
  'use strict';

  // ── Setup: panel geometry, session restore, initial layout ──
  var isMobile = window.matchMedia('(max-width: 767px)').matches;
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var ring = document.getElementById('ring');
  var track = ring.querySelector('.ring-track');
  var panels = track.querySelectorAll('.panel');
  var dots = document.querySelectorAll('.ring-dot');
  var PANEL_COUNT = parseInt(ring.getAttribute('data-panel-count'), 10);
  var ANGLE_STEP = 360 / PANEL_COUNT;
  var panelDim = isMobile ? window.innerHeight : window.innerWidth;

  // Scroll state (angle-based)
  var currentAngle = 0;
  var targetAngle = 0;
  var rawTarget = 0;

  // Restore panel position after resize-triggered reload
  var _saved = parseInt(sessionStorage.getItem('srm-panel'), 10);
  if (!isNaN(_saved) && _saved >= 0 && _saved < PANEL_COUNT) {
    sessionStorage.removeItem('srm-panel');
    currentAngle = _saved * ANGLE_STEP;
    targetAngle = currentAngle;
    rawTarget = currentAngle;
  }
  // Tuning -- instant snap when user prefers reduced motion
  var SCROLL_EASE = reducedMotion ? 1.0 : 0.22;
  var prevActiveIdx = -1;
  var isSettled = true;

  function computeRadius() {
    return Math.round(panelDim / (2 * Math.tan(Math.PI / PANEL_COUNT)));
  }

  var radius = computeRadius();

  function snapAngle(a) {
    return Math.round(a / ANGLE_STEP) * ANGLE_STEP;
  }

  // Place each panel on the cylinder surface
  function layoutPanels() {
    for (var i = 0; i < panels.length; i++) {
      var angle = i * ANGLE_STEP;
      // Mobile spins panels around X (vertical deck); desktop uses Y (horizontal ring).
      panels[i].style.transform = isMobile
        ? 'rotateX(' + (-angle) + 'deg) translateZ(' + radius + 'px)'
        : 'rotateY(' + angle + 'deg) translateZ(' + radius + 'px)';
    }
  }

  function renderTrack() {
    track.style.transform = isMobile
      ? 'translateZ(' + (-radius) + 'px) rotateX(' + currentAngle + 'deg)'
      : 'translateZ(' + (-radius) + 'px) rotateY(' + (-currentAngle) + 'deg)';
  }

  layoutPanels();
  renderTrack();

  // ── Offscreen animation pause ──
  function updateOffscreen(activeIdx) {
    for (var p = 0; p < panels.length; p++) {
      var near = p === activeIdx
        || p === (activeIdx + 1) % PANEL_COUNT
        || p === (activeIdx - 1 + PANEL_COUNT) % PANEL_COUNT;
      if (near) panels[p].removeAttribute('data-offscreen');
      else panels[p].setAttribute('data-offscreen', '');
    }
  }

  // ── Tick ──
  var rafId = 0;

  function startTick() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  function unsettle() {
    if (isSettled) {
      isSettled = false;
      track.style.willChange = 'transform';
      ring.dispatchEvent(new CustomEvent('panelunsettle'));
    }
    startTick();
  }

  // ── Wheel (desktop) ──
  if (!isMobile) {
    ring.addEventListener('wheel', function (e) {
      if (ring.classList.contains('is-iframe-active')) return;
      e.preventDefault();

      var delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      // Normalise deltaMode: 1 = line units (≈40px), 2 = page units (one panel).
      if (e.deltaMode === 1) delta *= 40;
      if (e.deltaMode === 2) delta *= panelDim;

      rawTarget += (delta / panelDim) * ANGLE_STEP;
      targetAngle = rawTarget;

      unsettle();

    }, { passive: false });
  }

  // ── Touch (mobile) ──
  if (isMobile) {
    var touchStartY = 0;
    var touchStartX = 0;
    var touchStartAngle = 0;
    var lastTouchY = 0;
    var lastTouchTime = 0;
    var velocity = 0;
    var isDragging = false;
    var dragRaf = 0;
    var pendingAngle = 0;
    var isHorizontalScroll = false;
    var directionLocked = false;

    ring.addEventListener('touchstart', function (e) {
      // When iframe is interactive, don't capture touches for carousel rotation
      if (ring.classList.contains('is-iframe-active')) {
        isDragging = false;
        return;
      }
      isDragging = true;
      isHorizontalScroll = false;
      directionLocked = false;
      velocity = 0;
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchStartAngle = currentAngle;
      pendingAngle = currentAngle;
      lastTouchY = touchStartY;
      lastTouchTime = Date.now();
    }, { passive: true });

    ring.addEventListener('touchmove', function (e) {
      if (!isDragging) return;
      if (e.touches.length > 1) return;

      // Direction lock: vertical swipes rotate the ring, horizontal swipes on
      // the directory list fall through to native scroll.
      if (!directionLocked) {
        var dx = Math.abs(e.touches[0].clientX - touchStartX);
        var dy = Math.abs(e.touches[0].clientY - touchStartY);
        if (dx + dy > 8) {
          directionLocked = true;
          if (dx > dy && e.target.closest && e.target.closest('.directory-list')) {
            isHorizontalScroll = true;
          }
        }
      }

      if (isHorizontalScroll) return;
      e.preventDefault();

      var touchY = e.touches[0].clientY;
      var now = Date.now();
      var dt = now - lastTouchTime;

      if (dt > 0) {
        var raw = (lastTouchY - touchY) / dt;
        velocity = Math.max(-3, Math.min(3, raw));
      }

      lastTouchY = touchY;
      lastTouchTime = now;

      var deltaY = touchStartY - touchY;
      pendingAngle = touchStartAngle + (deltaY / panelDim) * ANGLE_STEP;

      if (!dragRaf) {
        dragRaf = requestAnimationFrame(function () {
          dragRaf = 0;
          currentAngle = pendingAngle;
          rawTarget = currentAngle;
          targetAngle = currentAngle;
          renderTrack();

          unsettle();

          var norm = ((Math.round(currentAngle / ANGLE_STEP) % PANEL_COUNT) + PANEL_COUNT) % PANEL_COUNT;
          if (norm !== prevActiveIdx) {
            prevActiveIdx = norm;
            dots.forEach(function (dot, i) {
              dot.classList.toggle('is-active', i === norm);
            });
            updateOffscreen(norm);
            ring.dispatchEvent(new CustomEvent('panelchange', { detail: { index: norm } }));
          }
        });
      }
    }, { passive: false });

    function onTouchEnd() {
      isDragging = false;
      var wasHorizontalScroll = isHorizontalScroll;
      isHorizontalScroll = false;
      directionLocked = false;
      if (dragRaf) { cancelAnimationFrame(dragRaf); dragRaf = 0; }
      if (wasHorizontalScroll) return;
      currentAngle = pendingAngle;

      var nearest = snapAngle(currentAngle);
      var SWIPE_THRESHOLD = 0.15; // min velocity to trigger directional snap

      if (Math.abs(velocity) > SWIPE_THRESHOLD) {
        // Swipe detected: always advance at least one panel in swipe direction
        var dir = velocity > 0 ? 1 : -1;
        var next = nearest + dir * ANGLE_STEP;
        // If we already passed the next panel, snap to the one after
        if (dir > 0 && next < currentAngle) next += ANGLE_STEP;
        if (dir < 0 && next > currentAngle) next -= ANGLE_STEP;
        targetAngle = next;
      } else {
        // No significant swipe: snap to nearest panel
        targetAngle = nearest;
      }

      rawTarget = targetAngle;
      unsettle();
    }
    ring.addEventListener('touchend', onTouchEnd, { passive: true });
    ring.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  // ── Dots ──
  dots.forEach(function (dot) {
    dot.addEventListener('click', function () {
      var idx = parseInt(dot.getAttribute('data-dot'), 10);
      var target = idx * ANGLE_STEP;
      var norm = ((currentAngle % 360) + 360) % 360;
      var diff = target - norm;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      targetAngle = currentAngle + diff;
      rawTarget = targetAngle;
      unsettle();
    });
  });

  // ── Snap-to (programmatic, e.g. skip link) ──
  ring.addEventListener('snapto', function (e) {
    var idx = e.detail.index;
    var target = idx * ANGLE_STEP;
    var norm = ((currentAngle % 360) + 360) % 360;
    var diff = target - norm;
    if (diff > 180) diff -= 360;
    if (diff < -180) diff += 360;
    targetAngle = currentAngle + diff;
    rawTarget = targetAngle;
    unsettle();
  });

  // ── Keyboard (scoped to ring so screen readers can still use arrow keys) ──
  ring.setAttribute('tabindex', '0');
  ring.setAttribute('role', 'region');
  ring.setAttribute('aria-roledescription', 'carousel');
  ring.setAttribute('aria-label', 'Site panels');

  ring.addEventListener('keydown', function (e) {
    // Only navigate panels when the ring itself has focus, not child elements
    if (e.target !== ring) return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      targetAngle = snapAngle(currentAngle) + ANGLE_STEP;
      rawTarget = targetAngle;
      unsettle();

    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      targetAngle = snapAngle(currentAngle) - ANGLE_STEP;
      rawTarget = targetAngle;
      unsettle();

    }
  });

  function tick() {
    rafId = 0;

    var diff = targetAngle - currentAngle;
    var moving = Math.abs(diff) > 0.05;

    if (moving) {
      currentAngle += diff * SCROLL_EASE;
      renderTrack();
    } else if (currentAngle !== targetAngle) {
      currentAngle = targetAngle;
      renderTrack();
    }

    // Active panel index
    var norm = ((Math.round(currentAngle / ANGLE_STEP) % PANEL_COUNT) + PANEL_COUNT) % PANEL_COUNT;
    if (norm !== prevActiveIdx) {
      prevActiveIdx = norm;
      dots.forEach(function (dot, i) {
        dot.classList.toggle('is-active', i === norm);
      });
      updateOffscreen(norm);
      ring.dispatchEvent(new CustomEvent('panelchange', { detail: { index: norm } }));
    }

    // Stop loop when settled -- restarts on next input via startTick()
    if (!isSettled && currentAngle === targetAngle) {
      isSettled = true;
      track.style.willChange = 'auto';
      ring.dispatchEvent(new CustomEvent('panelsettle', { detail: { index: norm } }));
      return;
    }

    if (moving || currentAngle !== targetAngle) {
      rafId = requestAnimationFrame(tick);
    }
  }

  // Initial render is already done; start loop only on first input.
  var initIdx = ((Math.round(currentAngle / ANGLE_STEP) % PANEL_COUNT) + PANEL_COUNT) % PANEL_COUNT;
  prevActiveIdx = initIdx;
  dots.forEach(function (dot, i) { dot.classList.toggle('is-active', i === initIdx); });
  updateOffscreen(initIdx);
  ring.dispatchEvent(new CustomEvent('panelsettle', { detail: { index: initIdx } }));

  // ── Skip link: jump straight to the directory panel ──
  var skip = document.querySelector('.skip-link');
  if (skip) {
    skip.addEventListener('click', function (e) {
      e.preventDefault();
      var dirIdx = parseInt(ring.getAttribute('data-directory-index'), 10);
      ring.dispatchEvent(new CustomEvent('snapto', { detail: { index: dirIdx } }));
      ring.focus();
    });
  }

  // ── Pause when hidden ──
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    } else if (!isSettled) {
      startTick();
    }
  });

  // ── Resize ──
  window.addEventListener('resize', function () {
    var wasMobile = isMobile;
    isMobile = window.matchMedia('(max-width: 767px)').matches;
    if (isMobile !== wasMobile) {
      var norm = ((Math.round(currentAngle / ANGLE_STEP) % PANEL_COUNT) + PANEL_COUNT) % PANEL_COUNT;
      sessionStorage.setItem('srm-panel', norm);
      window.location.reload();
      return;
    }
    panelDim = isMobile ? window.innerHeight : window.innerWidth;
    radius = computeRadius();
    layoutPanels();
    renderTrack();
  });

  // ── Join / info overlay ──
  // Chrome's preserve-3d hit-testing can route clicks to a rotated neighbouring
  // panel instead of an interactive element. The fix: transparent <a> elements
  // OUTSIDE the ring's perspective context. They sit invisibly over the real
  // controls on settle and hide on unsettle.
  var JOIN_IDX = PANEL_COUNT - 1;
  var overlays = [
    { el: document.getElementById('join-link-overlay'), sel: '.join-button' },
    { el: document.getElementById('info-link-overlay'), sel: '.join-info' },
  ].filter(function (o) { return o.el; });

  if (overlays.length) {
    ring.addEventListener('panelsettle', function (e) {
      if (e.detail.index !== JOIN_IDX) return;
      var panel = document.querySelector('.panel[data-index="' + JOIN_IDX + '"]');
      if (!panel) return;
      overlays.forEach(function (o) {
        var target = panel.querySelector(o.sel);
        if (!target) return;
        var r = target.getBoundingClientRect();
        o.el.style.top = r.top + 'px';
        o.el.style.left = r.left + 'px';
        o.el.style.width = r.width + 'px';
        o.el.style.height = r.height + 'px';
        o.el.style.display = 'block';
      });
    });
    ring.addEventListener('panelunsettle', function () {
      overlays.forEach(function (o) { o.el.style.display = 'none'; });
    });
    // The overlay covers the real control, so the control's own :hover never
    // fires. Forward hover state from the overlay to the control underneath.
    overlays.forEach(function (o) {
      o.el.addEventListener('mouseenter', function () {
        var panel = document.querySelector('.panel[data-index="' + JOIN_IDX + '"]');
        if (!panel) return;
        var target = panel.querySelector(o.sel);
        if (target) target.classList.add('is-overlay-hover');
      });
      o.el.addEventListener('mouseleave', function () {
        var panel = document.querySelector('.panel[data-index="' + JOIN_IDX + '"]');
        if (!panel) return;
        var target = panel.querySelector(o.sel);
        if (target) target.classList.remove('is-overlay-hover');
      });
    });
  }
})();
