// ============================================================
// js/preview.js — SRM WebRing site preview panel
// Loads member sites in a sandboxed iframe (with a timeout and a
// fallback card) and wires prev/next/random/open controls to the
// Explore panel of the ring carousel.
// ============================================================
// ── Site preview (Explore panel) ──
// Adapted from webring.ca's public/preview.js. Loads members via SRMData
// and renders an iframe preview with prev/next/random/open controls.
(function () {
  'use strict';

  var EXPLORE_INDEX = 3;
  var panel = document.getElementById('preview-panel');
  if (!panel) return;

  var iframeWrap = document.getElementById('preview-iframe-wrap');
  var skeleton = document.getElementById('preview-skeleton');
  var skeletonName = document.getElementById('preview-skeleton-name');
  var fallbackEl = document.getElementById('preview-fallback');
  var fallbackName = document.getElementById('preview-fallback-name');
  var fallbackMeta = document.getElementById('preview-fallback-meta');
  var fallbackLink = document.getElementById('preview-fallback-link');
  var nameEl = document.getElementById('preview-name');
  var urlEl = document.getElementById('preview-url');
  var cityEl = document.getElementById('preview-city');
  var openEl = document.getElementById('preview-open');
  var prevBtn = document.getElementById('preview-prev');
  var nextBtn = document.getElementById('preview-next');
  var randomBtn = document.getElementById('preview-random');
  var overlay = document.getElementById('preview-overlay');
  var exitBtn = document.getElementById('preview-exit');
  var ringEl = document.getElementById('ring');

  if (!window.SRMData) return;
  window.SRMData.load().then(function (members) {
    if (!members || !members.length) return;

    // On touch devices, show "Tap to interact" instead of "Click to interact"
    if (window.matchMedia('(max-width: 767px)').matches) {
      var hint = overlay.querySelector('.preview-overlay-hint');
      if (hint) hint.textContent = 'Tap to interact';
    }

    var currentIdx = Math.floor(Math.random() * members.length);
    var currentIframe = null;
    var loadTimer = null;
    var isActive = false;
    var isSettled = false;

    // Hide all preview content until panel is active
    panel.style.opacity = '0';
    panel.style.transition = 'opacity 0.2s';

    // ── Preview state & helpers ──
    function previewMember(m) {
      return {
        name: m.name,
        url: m.website,
        city: m.location || m.program || '',
        frameable: m.frameable !== false
      };
    }

    function updateControls(idx) {
      var m = previewMember(members[idx]);
      nameEl.textContent = m.name;
      try { urlEl.textContent = new URL(m.url).hostname.replace(/^www\./, ''); } catch (e) { urlEl.textContent = m.url; }
      urlEl.href = m.url;
      cityEl.textContent = m.city;
      openEl.href = m.url;
    }

    // ── Preview lifecycle: destroy / fallback / load ──
    function destroyPreview() {
      if (loadTimer) { clearTimeout(loadTimer); loadTimer = null; }
      if (currentIframe) { currentIframe.remove(); currentIframe = null; }
      fallbackEl.style.display = 'none';
      skeleton.style.display = 'flex';
      overlay.classList.remove('is-dismissed', 'is-fading');
      overlay.classList.add('is-loading');
      if (exitBtn) exitBtn.classList.remove('is-visible');
      if (ringEl) ringEl.classList.remove('is-iframe-active');
    }

    function showFallback(idx) {
      var m = previewMember(members[idx]);
      skeleton.style.display = 'none';
      if (currentIframe) { currentIframe.remove(); currentIframe = null; }
      fallbackName.textContent = m.name;
      fallbackMeta.textContent = m.city || '';
      fallbackLink.href = m.url;
      fallbackEl.style.display = 'flex';
      overlay.classList.remove('is-loading');
    }

    function loadPreview(idx) {
      destroyPreview();
      var m = previewMember(members[idx]);
      updateControls(idx);

      // Skip iframe entirely for sites that block framing
      if (m.frameable === false) {
        showFallback(idx);
        return;
      }

      skeletonName.textContent = m.name;

      var iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
      iframe.setAttribute('referrerpolicy', 'no-referrer');
      iframe.setAttribute('title', m.name + ' website');
      currentIframe = iframe;

      loadTimer = setTimeout(function () {
        if (currentIframe === iframe) showFallback(idx);
      }, 5000);

      iframe.addEventListener('load', function () {
        if (currentIframe !== iframe) return;
        clearTimeout(loadTimer);
        loadTimer = null;

        // Reading contentWindow.location throws for cross-origin sites; a throw
        // means it framed fine, while a readable page means framing was blocked.
        try {
          iframe.contentWindow.location.href;
          showFallback(idx);
        } catch (e) {
          skeleton.style.display = 'none';
          iframe.classList.add('is-loaded');
          overlay.classList.remove('is-loading');
        }
      });

      iframe.addEventListener('error', function () {
        if (currentIframe === iframe) {
          clearTimeout(loadTimer);
          showFallback(idx);
        }
      });

      iframe.src = m.url;
      iframeWrap.appendChild(iframe);
    }

    prevBtn.addEventListener('click', function () {
      currentIdx = (currentIdx - 1 + members.length) % members.length;
      if (isActive) loadPreview(currentIdx);
    });

    nextBtn.addEventListener('click', function () {
      currentIdx = (currentIdx + 1) % members.length;
      if (isActive) loadPreview(currentIdx);
    });

    randomBtn.addEventListener('click', function () {
      var newIdx;
      do { newIdx = Math.floor(Math.random() * members.length); } while (newIdx === currentIdx && members.length > 1);
      currentIdx = newIdx;
      if (isActive) loadPreview(currentIdx);
    });

    // ── Overlay: dismiss to interact, restore on exit/blur ──
    // Click overlay to dismiss and interact with iframe
    var pendingDismiss = false;
    overlay.addEventListener('click', function (e) {
      if (!isActive) return;
      e.stopPropagation();
      if (overlay.classList.contains('is-dismissed')) return;

      overlay.classList.add('is-fading');
      pendingDismiss = true;
      ringEl.dispatchEvent(new CustomEvent('snapto', { detail: { index: EXPLORE_INDEX } }));
    });

    function updateOverlayState() {
      overlay.classList.toggle('is-ready', isSettled);
    }

    function restoreOverlay() {
      if (!overlay.classList.contains('is-dismissed')) return;
      overlay.classList.remove('is-dismissed', 'is-fading');
      if (currentIframe) {
        currentIframe.classList.remove('is-interactive');
        currentIframe.blur();
      }
      if (exitBtn) exitBtn.classList.remove('is-visible');
      if (ringEl) ringEl.classList.remove('is-iframe-active');
      window.focus();
    }

    if (exitBtn) {
      var exitTouchStarted = false;
      exitBtn.addEventListener('touchstart', function (e) {
        e.stopPropagation();
        exitTouchStarted = true;
      }, { passive: true });
      exitBtn.addEventListener('touchend', function (e) {
        e.stopPropagation();
        if (exitTouchStarted) {
          exitTouchStarted = false;
          e.preventDefault();
          restoreOverlay();
        }
      });
      exitBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        restoreOverlay();
      });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') restoreOverlay();
    });

    document.addEventListener('mousedown', function (e) {
      if (!overlay.classList.contains('is-dismissed')) return;
      if (!currentIframe || !currentIframe.contains(e.target)) {
        restoreOverlay();
      }
    });

    window.addEventListener('blur', function () {
      if (!overlay.classList.contains('is-dismissed')) return;
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        restoreOverlay();
      });
    });

    overlay.addEventListener('wheel', function () {
      if (overlay.classList.contains('is-dismissed')) {
        restoreOverlay();
        isSettled = false;
      }
    });

    var isMobilePreview = window.matchMedia('(max-width: 767px)').matches;

    // Desktop: listen for panelchange events from the ring
    if (!isMobilePreview) {
      ringEl.addEventListener('panelchange', function (e) {
        if (e.detail.index === EXPLORE_INDEX && !isActive) {
          isActive = true;
          panel.style.opacity = '1';
          loadPreview(currentIdx);
        } else if (e.detail.index !== EXPLORE_INDEX && isActive) {
          isActive = false;
          isSettled = false;
          panel.style.opacity = '0';
          destroyPreview();
        }
      });
    }

    // Re-enable overlay when scrolling starts (prevent iframe capturing scroll)
    ringEl.addEventListener('panelunsettle', function () {
      isSettled = false;
      restoreOverlay();
      updateOverlayState();
    });

    // Allow interaction only when ring settles on this panel
    ringEl.addEventListener('panelsettle', function (e) {
      if (e.detail.index === EXPLORE_INDEX && isActive) {
        isSettled = true;
        updateOverlayState();
        if (pendingDismiss) {
          pendingDismiss = false;
          overlay.classList.add('is-dismissed');
          if (currentIframe) currentIframe.classList.add('is-interactive');
          if (exitBtn) exitBtn.classList.add('is-visible');
          ringEl.classList.add('is-iframe-active');
        }
      }
    });

    // Mobile: use IntersectionObserver instead of panelchange events
    if (isMobilePreview) {
      var panelEl = panel.closest('.panel');
      if (panelEl && 'IntersectionObserver' in window) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && !isActive) {
              isActive = true;
              panel.style.opacity = '1';
              loadPreview(currentIdx);
            } else if (!entry.isIntersecting && isActive) {
              isActive = false;
              panel.style.opacity = '0';
              destroyPreview();
            }
          });
        }, { threshold: 0.5 });
        observer.observe(panelEl);
      }
    }
  });
})();
