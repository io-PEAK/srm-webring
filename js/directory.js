// ============================================================
// js/directory.js — SRM NCR WebRing directory panel
// Renders the member list (desktop rows, mobile cards), wires the
// search filter, and syncs highlights with the ring viz (SRMViz).
// ============================================================
/* SRM NCR Webring — directory panel.
 *
 * Renders the member list (desktop: paginated rows; mobile: horizontal cards),
 * wires up the search filter, and synchronises highlights with the ring
 * visualization via window.SRMViz.
 */
(function () {
  'use strict';

  var PAGE_SIZE = 8;
  var MOBILE_QUERY = '(max-width: 767px)';

  var listEl, searchEl, pageInfo, pagePrev, pageNext, cardPrev, cardNext, paginationEl, joinCount;
  var members = [];
  var page = 0;
  var query = '';
  var isMobile = window.matchMedia(MOBILE_QUERY).matches;

  // ── Filtering & key helpers ──
  function domain(u) {
    return window.SRMData.hostname(u);
  }

  function memberKey(m) {
    return window.SRMData.key(m.website);
  }

  function matches(m) {
    if (!query) return true;
    var hay = [m.name, m.program, m.location, m.website, domain(m.website)].join(' ').toLowerCase();
    return hay.indexOf(query) !== -1;
  }

  // ── Row rendering ──
  function buildRow(m, isMatch) {
    var a = document.createElement('a');
    a.className = 'directory-row' + (isMatch ? ' is-search-match' : '');
    a.href = m.website;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.setAttribute('data-key', memberKey(m));

    var badge = document.createElement('span');
    badge.className = 'directory-row-badge';
    if (m.badge) {
      var img = document.createElement('img');
      img.src = m.badge;
      img.alt = (m.name || 'member') + ' badge';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        badge.classList.add('is-missing');
        badge.textContent = '\u2014';
      });
      badge.appendChild(img);
    } else {
      badge.classList.add('is-missing');
      badge.textContent = '\u2014';
    }

    var name = document.createElement('span');
    name.className = 'directory-row-name';
    name.textContent = m.name || 'Unnamed';

    var course = document.createElement('span');
    course.className = 'directory-row-course';
    course.textContent = m.program || '\u2014';

    var site = document.createElement('span');
    site.className = 'directory-row-site';
    site.textContent = domain(m.website);

    var city = document.createElement('span');
    city.className = 'directory-row-city';
    city.textContent = m.location || 'SRM NCR';

    var visit = document.createElement('span');
    visit.className = 'directory-row-visit';
    visit.setAttribute('aria-hidden', 'true');
    visit.innerHTML = '&nearr;';

    a.appendChild(badge);
    a.appendChild(name);
    a.appendChild(course);
    a.appendChild(site);
    a.appendChild(city);
    a.appendChild(visit);
    return a;
  }

  function rowsOf(list) {
    return Array.prototype.filter.call(list.children, function (n) {
      return n.classList && n.classList.contains('directory-row');
    });
  }

  function rowElFor(key) {
    var found = null;
    rowsOf(listEl).some(function (n) {
      if (n.getAttribute('data-key') === key) { found = n; return true; }
      return false;
    });
    return found;
  }

  // ── Render: rows, pagination, viz highlight ──
  function render() {
    var filtered = members.filter(matches);
    var matchKeys = query
      ? filtered.map(memberKey)
      : [];

    // Clear previous rows (keep the header).
    rowsOf(listEl).forEach(function (n) { n.remove(); });

    var showEmpty = !filtered.length;
    var isPaginated = false;

    if (!showEmpty) {
      var visible;
      if (isMobile) {
        visible = filtered;
      } else if (query) {
        // While searching, show every match and let the list scroll.
        visible = filtered;
        isPaginated = filtered.length > PAGE_SIZE;
      } else {
        visible = paginate(filtered);
        isPaginated = members.length > PAGE_SIZE;
      }

      visible.forEach(function (m) {
        listEl.appendChild(buildRow(m, query && matches(m)));
      });

      // Hover sync with the ring visualization (desktop).
      visible.forEach(function (m) {
        var row = rowElFor(memberKey(m));
        if (!row) return;
        row.addEventListener('mouseenter', function () {
          if (window.SRMViz) window.SRMViz.setHover(memberKey(m));
        });
        row.addEventListener('mouseleave', function () {
          if (window.SRMViz) window.SRMViz.clearHover();
        });
      });
    } else {
      var empty = document.createElement('div');
      empty.className = 'directory-row directory-row--empty';
      empty.textContent = 'No members match.';
      empty.style.color = 'var(--fg-muted)';
      empty.style.cursor = 'default';
      empty.style.fontSize = '0.9rem';
      listEl.appendChild(empty);
    }

    // List-level search dimming + scroll state.
    listEl.classList.toggle('has-search', !!query);
    listEl.classList.toggle('is-paginated', isPaginated);

    // Pagination controls (desktop, no active search). Hidden entirely unless
    // the list spans multiple pages.
    if (pagePrev && pageNext && pageInfo) {
      var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
      if (paginationEl) paginationEl.classList.toggle('is-hidden', query || isMobile || pages <= 1);
      if (query || isMobile) {
        pagePrev.disabled = true;
        pageNext.disabled = true;
        pageInfo.textContent = '';
      } else {
        pagePrev.disabled = page <= 0;
        pageNext.disabled = page >= pages - 1;
        pageInfo.textContent = pages > 1 ? (page + 1) + ' / ' + pages : '';
      }
    }

    // Ring visualization highlight.
    if (window.SRMViz) window.SRMViz.highlight(matchKeys);
  }

  function paginate(filtered) {
    var pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    if (page >= pages) page = pages - 1;
    if (page < 0) page = 0;
    var start = page * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }

  function updateCount() {
    if (joinCount) joinCount.textContent = members.length;
  }

  function scrollCards(dir) {
    var card = listEl.querySelector('.directory-row');
    var amount = card ? card.getBoundingClientRect().width + 12 : 140;
    listEl.scrollBy({ left: dir * amount, behavior: 'smooth' });
  }

  function syncCardArrows() {
    if (!cardPrev || !cardNext) return;
    var maxScroll = listEl.scrollWidth - listEl.clientWidth;
    cardPrev.disabled = listEl.scrollLeft <= 0;
    cardNext.disabled = listEl.scrollLeft >= maxScroll - 1;
  }

  // ── Init: wire controls, load members ──
  function init() {
    listEl = document.querySelector('.directory-list');
    searchEl = document.getElementById('directory-search-input');
    pageInfo = document.getElementById('page-info');
    pagePrev = document.getElementById('page-prev');
    pageNext = document.getElementById('page-next');
    cardPrev = document.getElementById('card-prev');
    cardNext = document.getElementById('card-next');
    paginationEl = document.querySelector('.directory-pagination');
    joinCount = document.getElementById('joinCount');

    if (!listEl) return;

    window.addEventListener('resize', function () {
      isMobile = window.matchMedia(MOBILE_QUERY).matches;
      page = 0;
      render();
    });

    if (searchEl) {
      searchEl.addEventListener('input', function (e) {
        query = (e.target.value || '').toLowerCase().trim();
        page = 0;
        render();
      });
    }

    if (pagePrev) pagePrev.addEventListener('click', function () { if (page > 0) { page--; render(); } });
    if (pageNext) pageNext.addEventListener('click', function () { page++; render(); });

    if (cardPrev) cardPrev.addEventListener('click', function () { scrollCards(-1); });
    if (cardNext) cardNext.addEventListener('click', function () { scrollCards(1); });

    if (listEl) {
      listEl.addEventListener('scroll', syncCardArrows, { passive: true });
    }

    window.SRMData.load().then(function (data) {
      members = data;
      updateCount();
      render();
      syncCardArrows();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
