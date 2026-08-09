// ============================================================
// js/join.js — SRM NCR WebRing join page
// Handles the join/update form: city autocomplete, badge upload,
// custom validation, and the multipart POST to the backend worker
// that opens a pull request for the new member.
// ============================================================
(function () {
  'use strict';

  const API = 'https://backend.srmncrwebring.workers.dev';

  const form = document.getElementById('joinForm');
  const gradDateInput = document.getElementById('gradDate');
  const badgeInput = document.getElementById('badge');
  const badgePreview = document.getElementById('badgePreview');
  const submitBtn = document.getElementById('joinSubmit');
  const output = document.getElementById('output');
  const locationInput = document.getElementById('location');
  const locationMenu = document.getElementById('locationMenu');
  const locationList = document.getElementById('locationList');
  const locationEmpty = document.getElementById('locationEmpty');
  const programInput = document.getElementById('program');
  const programMenu = document.getElementById('programMenu');
  const programList = document.getElementById('programList');
  const programEmpty = document.getElementById('programEmpty');
  let citiesData = null;
  let programsData = null;

  // ── Draft persistence ──────────────────────────────
  // Keep typed details across the round-trip to badge.html (and
  // accidental refreshes) via sessionStorage; cleared on submit.
  const DRAFT_KEY = 'srm-join-draft';
  const DRAFT_FIELDS = ['name', 'website', 'program', 'location', 'gradDate', 'collegeEmail', 'personalEmail'];

  function currentStep() {
    const active = document.querySelector('.onboard-panel.is-active');
    const panels = Array.prototype.slice.call(document.querySelectorAll('.onboard-panel'));
    const idx = active ? panels.indexOf(active) : -1;
    return idx >= 0 ? idx + 1 : 1;
  }

  function saveDraft() {
    const data = { step: currentStep() };
    DRAFT_FIELDS.forEach(function (id) {
      const el = document.getElementById(id);
      if (el) data[id] = el.value;
    });
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) { /* noop */ }
  }

  function restoreDraft() {
    try {
      const data = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null');
      if (!data) return 1;
      DRAFT_FIELDS.forEach(function (id) {
        const el = document.getElementById(id);
        if (el && data[id] != null) el.value = data[id];
      });
      const n = parseInt(data.step, 10);
      return n >= 1 && n <= 3 ? n : 1;
    } catch (e) { return 1; }
  }

  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) { /* noop */ }
  }

  const savedStep = restoreDraft();
  form.addEventListener('input', saveDraft);
  form.addEventListener('change', saveDraft);

  // ── Autocomplete dropdowns (city / town + program) ──
  function populateCities() {
    return fetch('data/cities.json')
      .then(function (r) { return r.json(); })
      .then(function (cities) { citiesData = cities || {}; })
      .catch(function () { citiesData = {}; });
  }

  function populatePrograms() {
    return fetch('data/programs.json')
      .then(function (r) { return r.json(); })
      .then(function (programs) { programsData = Array.isArray(programs) ? programs : []; })
      .catch(function () { programsData = []; });
  }

  function effectiveLocation() {
    return locationInput ? locationInput.value.trim() : '';
  }

  function matchCities(query) {
    const q = query.toLowerCase();
    const out = [];
    Object.keys(citiesData || {}).forEach(function (key) {
      const c = citiesData[key];
      const name = c.name || key;
      if (key.indexOf(q) === 0 || name.toLowerCase().indexOf(q) !== -1 ||
          String(c.state || '').toLowerCase().indexOf(q) !== -1) {
        out.push({ name: name, note: c.state || '' });
      }
    });
    out.sort(function (a, b) {
      const an = a.name.toLowerCase().indexOf(q), bn = b.name.toLowerCase().indexOf(q);
      if (an === 0 && bn !== 0) return -1;
      if (bn === 0 && an !== 0) return 1;
      return a.name.localeCompare(b.name);
    });
    return out.slice(0, 14);
  }

  // True when `token` starts at the beginning of the name or of a word
  // inside it, so "M" doesn't match "coMputer" or "inforMation".
  function wordMatch(lower, token) {
    if (lower.indexOf(token) === 0) return true;
    let idx = lower.indexOf(token);
    while (idx !== -1) {
      const before = lower[idx - 1];
      if (before === ' ' || before === '(' || before === '-') return true;
      idx = lower.indexOf(token, idx + 1);
    }
    return false;
  }

  function matchPrograms(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const tokens = q.split(/\s+/);
    let out = (programsData || []).filter(function (p) {
      const lower = p.toLowerCase();
      return tokens.every(function (t) { return wordMatch(lower, t); });
    });
    // Fall back to a loose substring match if nothing matched at word starts.
    if (!out.length) {
      out = (programsData || []).filter(function (p) {
        return tokens.every(function (t) { return p.toLowerCase().indexOf(t) !== -1; });
      });
    }
    out.sort(function (a, b) {
      const al = a.toLowerCase(), bl = b.toLowerCase();
      const ap = al.indexOf(q) === 0, bp = bl.indexOf(q) === 0;
      if (ap && !bp) return -1;
      if (bp && !ap) return 1;
      return al.localeCompare(bl);
    });
    return out.slice(0, 14).map(function (p) { return { name: p, note: '' }; });
  }

  // Builds one dropdown: typing filters results, arrows move, Enter
  // selects, Escape/mousedown-outside closes.
  function attachAutocomplete(opts) {
    const input = opts.input;
    const menu = opts.menu;
    const list = opts.list;
    const empty = opts.empty;
    const match = opts.match;
    const picker = input.parentElement;
    let current = [];
    let activeIndex = -1;

    function openMenu() { if (menu) menu.hidden = false; }

    function closeMenu() {
      if (menu) menu.hidden = true;
      activeIndex = -1;
      if (list) {
        list.querySelectorAll('.join-location-item').forEach(function (el) {
          el.classList.remove('is-active');
        });
      }
    }

    function selectItem(item) {
      input.value = item.name;
      closeMenu();
      setFieldError(input, '');
    }

    function renderResults(query) {
      if (!list) return;
      current = match(query);
      list.textContent = '';
      if (empty) empty.hidden = current.length > 0;
      activeIndex = -1;
      current.forEach(function (r, i) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'join-location-item';
        item.setAttribute('role', 'option');
        const name = document.createElement('span');
        name.textContent = r.name;
        item.dataset.index = i;
        item.appendChild(name);
        if (r.note) {
          const note = document.createElement('small');
          note.textContent = r.note;
          item.appendChild(note);
        }
        // mousedown (with preventDefault) beats input blur so the selection registers.
        item.addEventListener('mousedown', function (e) {
          e.preventDefault();
          selectItem(r);
        });
        list.appendChild(item);
      });
      openMenu();
    }

    function setActive(i) {
      const items = list ? list.querySelectorAll('.join-location-item') : [];
      if (!items.length) return;
      if (i < 0) i = items.length - 1;
      if (i >= items.length) i = 0;
      activeIndex = i;
      items.forEach(function (el, idx) {
        el.classList.toggle('is-active', idx === i);
      });
      items[i].scrollIntoView({ block: 'nearest' });
    }

    input.addEventListener('input', function () {
      setFieldError(input, '');
      const v = input.value.trim();
      if (!v) closeMenu();
      else renderResults(v);
    });

    input.addEventListener('keydown', function (e) {
      const menuOpen = menu && !menu.hidden;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!menuOpen && input.value.trim()) renderResults(input.value);
        setActive(activeIndex + 1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (!menuOpen && input.value.trim()) renderResults(input.value);
        setActive(activeIndex - 1);
      } else if (e.key === 'Enter') {
        if (!menuOpen) return;
        const items = list.querySelectorAll('.join-location-item');
        if (activeIndex >= 0 && items[activeIndex]) {
          e.preventDefault();
          selectItem(current[activeIndex]);
        } else {
          closeMenu();
        }
      } else if (e.key === 'Escape') {
        closeMenu();
      }
    });

    if (picker) {
      document.addEventListener('mousedown', function (e) {
        if (!picker.contains(e.target)) closeMenu();
      });
    }
  }

  if (locationInput) {
    attachAutocomplete({
      input: locationInput,
      menu: locationMenu,
      list: locationList,
      empty: locationEmpty,
      match: matchCities,
    });
  }
  if (programInput) {
    attachAutocomplete({
      input: programInput,
      menu: programMenu,
      list: programList,
      empty: programEmpty,
      match: matchPrograms,
    });
  }
  populateCities();
  populatePrograms();

  // ── Widget snippet ────────────────────────────────────
  // Self-contained HTML a member can paste into their footer.
  // `ring` is the ring's origin, `site` is the member's own URL.
  // The 1x1 pixel pings the worker so the ring can confirm the
  // widget is actually installed on the member's site.
  function buildWidgetSnippet(ring, site) {
    const base = (ring || location.origin).replace(/\/$/, '');
    return [
      '<!-- SRM NCR WebRing widget -->',
      '<div class="srm-ring-widget">',
      '  <a href="' + base + '/#' + site + '?nav=prev" class="srm-ring-arrow">&larr;</a>',
      '  <a href="' + base + '/" class="srm-ring-logo">',
      '    <img src="' + base + '/img/tree_yellow.png" alt="SRM NCR WebRing" width="16" height="16">',
      '  </a>',
      '  <a href="' + base + '/#' + site + '?nav=next" class="srm-ring-arrow">&rarr;</a>',
      '</div>',
      '<img src="' + API + '/widget?site=' + encodeURIComponent(site) + '" width="1" height="1" alt="" style="border:0" aria-hidden="true">',
      '<style>',
      '.srm-ring-widget{display:inline-flex;align-items:center;gap:.6rem;padding:.5rem .9rem;',
      'border:1px solid rgba(12,77,162,.35);border-radius:999px;background:#fff;',
      'box-shadow:0 1px 3px rgba(0,0,0,.08)}',
      '.srm-ring-arrow{text-decoration:none;font-weight:700;font-size:1.1rem;color:#0c4da2;line-height:1}',
      '.srm-ring-logo{display:inline-flex;align-items:center;gap:.3rem;text-decoration:none;',
      'font-weight:700;letter-spacing:-.02em;color:#c8a008;font-size:.95rem;line-height:1}',
      '.srm-ring-logo img{width:16px;height:16px}',
      '</style>',
    ].join('\n');
  }

  function attachCopy(btn, snippetEl) {
    btn.addEventListener('click', function () {
      const text = snippetEl.textContent;
      const done = function () {
        btn.textContent = 'Copied!';
        btn.classList.add('is-copied');
        setTimeout(function () {
          btn.textContent = 'Copy code';
          btn.classList.remove('is-copied');
        }, 1500);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          fallbackCopy(text);
          done();
        });
      } else {
        fallbackCopy(text);
        done();
      }
    });
  }

  // Legacy clipboard fallback for browsers without navigator.clipboard.
  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (e) { /* noop */ }
    document.body.removeChild(ta);
  }

  // ── Badge upload preview ──
  if (badgeInput && badgePreview) {
    badgeInput.addEventListener('change', function () {
      const file = badgeInput.files && badgeInput.files[0];
      badgeInput.classList.toggle('has-file', !!file);
      if (file && file.type.startsWith('image/')) {
        badgePreview.src = URL.createObjectURL(file);
        badgePreview.classList.remove('is-empty');
      }
    });
  }

  // ── Custom validation (replaces browser default bubbles) ──
  function emailValid(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

  function monthIndex(mon) {
    const idx = MONTHS.indexOf(mon.toLowerCase().slice(0, 3));
    return idx === -1 ? NaN : idx + 1;
  }

  // Accepts DD/MM/YYYY, DD MMM YYYY, YYYY-MM-DD, etc.
  // Returns a valid Date or null.
  function parseGradDate(value) {
    const s = String(value || '').trim();
    let d, m, y;
    const monthRe = /^(\d{1,2})[\/\-\.\s]+([a-zA-Z]{3,9})[\/\-\.\s]+(\d{4})$/;
    const numericRe = /^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/;
    const isoRe = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
    if (numericRe.test(s)) {
      const parts = s.match(numericRe);
      d = +parts[1]; m = +parts[2]; y = +parts[3];
    } else if (monthRe.test(s)) {
      const parts = s.match(monthRe);
      d = +parts[1]; m = monthIndex(parts[2]); y = +parts[3];
    } else if (isoRe.test(s)) {
      const parts = s.match(isoRe);
      y = +parts[1]; m = +parts[2]; d = +parts[3];
    } else {
      return null;
    }
    if (isNaN(m)) return null;
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null;
    return date;
  }

  function urlValid(value) {
    try {
      const u = new URL(value);
      return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) {
      return false;
    }
  }

  function setFieldError(input, message) {
    const label = input.closest('label') || input.closest('.join-badge-field');
    input.classList.toggle('is-invalid', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    label.classList.toggle('has-error', !!message);
    let errEl = label.querySelector('.field-error');
    if (message) {
      if (!errEl) {
        errEl = document.createElement('em');
        errEl.className = 'field-error';
        label.appendChild(errEl);
      }
      errEl.textContent = message;
    } else if (errEl) {
      errEl.remove();
    }
  }

  // Live check for the college email field: the suffix is already fixed at
  // @srmist.edu.in, so flag any @ the user types themselves (double-@) as
  // soon as it appears instead of waiting for submit.
  function validateCollegeEmailLive() {
    const el = document.getElementById('collegeEmail');
    const prefix = el.value.trim();
    if (!prefix) {
      setFieldError(el, '');
      return true;
    }
    const msg = /^[a-z0-9._%+-]+$/i.test(prefix) && emailValid(prefix + '@srmist.edu.in')
      ? ''
      : (prefix.indexOf('@') !== -1
        ? "Don't include @srmist.edu.in, just your username (e.g. sn1234)."
        : 'Enter your SRM^NCR username (e.g. sn1234).');
    setFieldError(el, msg);
    return !msg;
  }

  function validate() {
    let firstInvalid = null;
    const check = function (input, message) {
      setFieldError(input, message);
      if (message && !firstInvalid) firstInvalid = input;
    };

    check(document.getElementById('name'), document.getElementById('name').value.trim() ? '' : 'Please enter your name.');

    const website = document.getElementById('website');
    const websiteValue = website.value.trim();
    check(website, websiteValue && urlValid(websiteValue) ? '' : 'Enter a valid website URL (https://...).');

    check(document.getElementById('program'), document.getElementById('program').value.trim() ? '' : 'Please enter your program.');

    const locValue = effectiveLocation();
    check(locationInput, locValue ? '' : 'Please enter your city or town.');

    const gradValue = gradDateInput.value.trim();
    let gradError = '';
    if (!gradValue) {
      gradError = 'Please pick your graduation date.';
    } else {
      const gradDate = parseGradDate(gradValue);
      if (!gradDate) {
        gradError = 'Enter the date as DD/MM/YYYY.';
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const maxDate = new Date();
        maxDate.setFullYear(today.getFullYear() + 10);
        if (gradDate < today) gradError = 'Graduation date must be in the future.';
        else if (gradDate > maxDate) gradError = 'Graduation date seems too far in the future.';
      }
    }
    check(gradDateInput, gradError);

    const college = document.getElementById('collegeEmail');
    const collegePrefix = college.value.trim();
    const collegeFull = collegePrefix + '@srmist.edu.in';
    check(college, /^[a-z0-9._%+-]+$/i.test(collegePrefix) && emailValid(collegeFull) ? '' : 'Enter your SRM^NCR username (e.g. sn1234).');
    const personal = document.getElementById('personalEmail');
    check(personal, emailValid(personal.value.trim()) ? '' : 'Enter a valid email.');

    const badgeFile = badgeInput.files && badgeInput.files[0];
    let badgeError = '';
    if (!badgeFile) badgeError = 'Please choose a badge image.';
    else if (badgeFile.size > 1024 * 1024) badgeError = 'Badge is too large (max 1 MB).';
    setFieldError(badgeInput, badgeError);
    if (badgeError && !firstInvalid) firstInvalid = badgeInput;

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  // Clear a field's error as soon as the user edits it.
  form.addEventListener('input', function (event) {
    if (!event.target.matches('input, select, textarea')) return;
    if (event.target.id === 'collegeEmail') {
      validateCollegeEmailLive();
      return;
    }
    if (event.target.classList.contains('is-invalid')) {
      setFieldError(event.target, '');
    }
  });

  // ── Stepwise onboarding (UniHaul-style: segmented bars, panels
  // that slide in from the right, step title + description under the bar) ──
  const stepIndicator = document.getElementById('stepIndicator');
  const stepTitle = document.getElementById('stepTitle');
  const stepDesc = document.getElementById('stepDesc');
  const stepBars = Array.prototype.slice.call(
    (document.getElementById('stepBars') || document).querySelectorAll('span')
  );
  const panels = Array.prototype.slice.call(document.querySelectorAll('.onboard-panel'));
  const heading = document.querySelector('.onboard-heading');

  const STEP_COPY = {
    1: {
      title: 'Your details',
      desc: 'Tell us about your site. We send a one-time verification link to your college email before anything goes live.',
    },
    2: {
      title: 'Check your inbox',
      desc: 'We sent a one-time link to your college email. Open it and click \u201cVerify my college email\u201d, your pull request opens the moment you do.',
    },
    3: {
      title: 'You\u2019re in, add the widget',
      desc: 'Paste this just before </body> on your homepage. The hidden pixel tells the ring you\u2019ve installed it; the navigation arrows link you into the ring.',
    },
  };

  // Entrance animations run only on step changes, never on first load.
  function replayAnim(el) {
    if (!el) return;
    el.classList.remove('is-animating');
    void el.offsetWidth;
    el.classList.add('is-animating');
  }

  function goToStep(n, animate) {
    stepBars.forEach(function (bar, i) {
      bar.classList.toggle('is-fill', i < n);
    });
    panels.forEach(function (panel, i) {
      panel.classList.toggle('is-active', i === n - 1);
    });
    if (stepIndicator) stepIndicator.textContent = 'Step ' + n;
    if (stepTitle) stepTitle.textContent = STEP_COPY[n].title;
    if (stepDesc) stepDesc.textContent = STEP_COPY[n].desc;
    if (animate) {
      replayAnim(panels[n - 1]);
      replayAnim(heading);
    }
    saveDraft();
  }

  // Restore the saved step (and re-render step 2/3 content) so a refresh
  // keeps the user where they were.
  goToStep(savedStep, false);
  if (savedStep === 2) {
    showPending(null);
    startPendingPoll(document.getElementById('website').value.trim());
  } else if (savedStep === 3) {
    showSuccess(null);
  }

  // ── Submit: multipart POST to the backend worker ──
  // Step 1 only — the worker emails a verification link; the PR is
  // opened when the user clicks it in their college inbox.
  let submittedForm = null;

  function buildFormData() {
    const form = new FormData();
    form.append('name', document.getElementById('name').value.trim());
    form.append('website', document.getElementById('website').value.trim());
    form.append('program', document.getElementById('program').value.trim());
    // Date inputs report yyyy-mm-dd; store as DD/MM/YYYY.
    const gradRaw = gradDateInput.value;
    let gradSent = gradRaw;
    if (/^\d{4}-\d{2}-\d{2}$/.test(gradRaw)) {
      const parts = gradRaw.split('-');
      gradSent = parts[2] + '/' + parts[1] + '/' + parts[0];
    }
    form.append('gradDate', gradSent);
    form.append('collegeEmail', document.getElementById('collegeEmail').value.trim() + '@srmist.edu.in');
    form.append('personalEmail', document.getElementById('personalEmail').value.trim());
    form.append('badgeFile', badgeInput.files[0]);
    form.append('location', effectiveLocation());
    return form;
  }

  function submitJoin() {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending link\u2026';

    fetch(API + '/join', { method: 'POST', body: submittedForm })
      .then(function (response) {
        return response.json().then(function (data) {
          return { ok: response.ok, data: data };
        });
      })
      .then(function (result) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit request';
        if (result.ok && result.data.pending) {
          goToStep(2, true);
          showPending(result.data.message);
          startPendingPoll(document.getElementById('website').value.trim());
        } else if (result.ok && result.data.success && result.data.prUrl) {
          goToStep(3, true);
          showSuccess(result.data.prUrl);
        } else {
          showStatus(result.data.error || 'Something went wrong. Please try again.', true);
        }
      })
      .catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit request';
        showStatus('Network error: ' + error.message, true);
      });
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    if (!validate()) return;
    submittedForm = buildFormData();
    submitJoin();
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Poll the worker while the member waits on step 2. As soon as the
  // verification link is clicked, auto-advance to step 3 with the widget.
  let pendingPoll = null;

  function stopPendingPoll() {
    if (pendingPoll) { clearInterval(pendingPoll); pendingPoll = null; }
  }

  function startPendingPoll(site) {
    stopPendingPoll();
    if (!site) return;
    pendingPoll = setInterval(function () {
      fetch(API + '/join/status?site=' + encodeURIComponent(site))
        .then(function (r) { return r.json(); })
        .then(function (data) {
          if (data && data.verified) {
            stopPendingPoll();
            goToStep(3, true);
            showSuccess(data.prUrl || null);
          }
        })
        .catch(function () { /* transient network hiccup, keep polling */ });
    }, 3000);
  }

  function showPending(message) {
    const verifyContent = document.getElementById('verifyContent');
    verifyContent.textContent = '';
    const el = document.createElement('div');
    el.className = 'onboard-flow';

    const collegeEmail = document.getElementById('collegeEmail').value.trim() + '@srmist.edu.in';
    const line = document.createElement('p');
    line.innerHTML = message
      ? escapeHtml(message)
      : 'Verification link sent to <strong>' + escapeHtml(collegeEmail) + '</strong>.';
    el.appendChild(line);

    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'onboard-inline-link';
    restart.textContent = 'Start over';
    restart.addEventListener('click', function () {
      stopPendingPoll();
      clearDraft();
      location.reload();
    });
    line.appendChild(restart);

    const steps = document.createElement('ul');
    steps.className = 'onboard-checklist';
    ['Open the email from the ring bot', 'Click <strong>Verify my college email</strong>', 'Your pull request opens automatically'].forEach(function (text) {
      const li = document.createElement('li');
      li.innerHTML = text;
      steps.appendChild(li);
    });
    el.appendChild(steps);

    const actions = document.createElement('div');
    actions.className = 'onboard-actions';

    const verifiedBtn = document.createElement('button');
    verifiedBtn.type = 'button';
    verifiedBtn.className = 'join-submit';
    verifiedBtn.textContent = 'Show my widget code';
    verifiedBtn.addEventListener('click', function () {
      stopPendingPoll();
      goToStep(3, true);
      showSuccess(null);
    });
    actions.appendChild(verifiedBtn);

    const resend = document.createElement('button');
    resend.type = 'button';
    resend.className = 'onboard-link';
    resend.textContent = 'Resend link';
    resend.addEventListener('click', function () {
      if (submittedForm) submitJoin();
    });
    actions.appendChild(resend);

    el.appendChild(actions);
    verifyContent.appendChild(el);
  }

  function showSuccess(prUrl) {
    const successContent = document.getElementById('successContent');
    successContent.textContent = '';
    const el = document.createElement('div');

    const line = document.createElement('p');
    line.innerHTML = 'Verified! Your entry is a pull request, waiting for review.';
    el.appendChild(line);

    if (prUrl) {
      const link = document.createElement('a');
      link.href = prUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = 'View pull request \u2192';
      link.style.fontWeight = '600';
      el.appendChild(link);
    }

    const widgetHeading = document.createElement('p');
    widgetHeading.style.marginTop = '1.1rem';
    widgetHeading.style.marginBottom = '0.4rem';
    widgetHeading.style.fontWeight = '700';
    widgetHeading.textContent = 'Paste this into your footer, just before </body>:';
    el.appendChild(widgetHeading);

    const snippetCode = document.createElement('code');
    snippetCode.style.display = 'block';
    snippetCode.style.whiteSpace = 'pre-wrap';
    snippetCode.style.wordBreak = 'break-all';
    snippetCode.style.fontFamily = 'var(--font-mono)';
    snippetCode.style.fontSize = '0.72rem';
    snippetCode.style.padding = '0.75rem';
    snippetCode.style.background = 'rgba(0,0,0,.18)';
    snippetCode.style.borderRadius = '6px';
    snippetCode.style.border = '1px solid var(--border)';
    snippetCode.textContent = buildWidgetSnippet(location.origin, document.getElementById('website').value.trim());
    el.appendChild(snippetCode);

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'widget-copy';
    copyBtn.style.position = 'static';
    copyBtn.style.marginTop = '0.5rem';
    copyBtn.textContent = 'Copy code';
    attachCopy(copyBtn, snippetCode);
    el.appendChild(copyBtn);

    const note = document.createElement('p');
    note.className = 'onboard-note';
    note.textContent = 'Keep the 1x1 pixel in the snippet, it proves the widget is installed. If it goes missing, a bot emails you after 21 days and removes your entry after 30.';
    el.appendChild(note);

    const restart = document.createElement('button');
    restart.type = 'button';
    restart.className = 'onboard-link';
    restart.textContent = 'Start over';
    restart.addEventListener('click', function () {
      clearDraft();
      location.reload();
    });
    el.appendChild(restart);

    successContent.appendChild(el);
  }

  function showStatus(message, isError) {
    output.textContent = '';
    output.className = 'join-status is-visible ' + (isError ? 'is-error' : 'is-success');
    if (typeof message === 'string') {
      output.textContent = message;
    } else {
      output.appendChild(message);
    }
  }
})();
