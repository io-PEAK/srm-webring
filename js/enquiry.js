// ============================================================
// js/enquiry.js — SRM WebRing enquiry page
// Validates the enquiry form and POSTs it to the backend worker,
// which opens a GitHub issue and returns its URL to the visitor.
// ============================================================
(function () {
  'use strict';

  var output = document.getElementById('output');
  var form = document.getElementById('enquiryForm');
  var submitBtn = document.getElementById('enquirySubmit');
  var nameInput = document.getElementById('name');
  var emailInput = document.getElementById('email');
  var typeEl = document.getElementById('type');
  var detailsInput = document.getElementById('details');

  // Preselect request type from ?type=...
  var params = new URLSearchParams(window.location.search);
  var typeParam = params.get('type');
  if (typeParam && typeEl) {
    for (var i = 0; i < typeEl.options.length; i++) {
      if (typeEl.options[i].value === typeParam) {
        typeEl.selectedIndex = i;
        break;
      }
    }
  }

  // ── Validation ──
  function emailValid(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function setFieldError(input, message) {
    var label = input.closest('label');
    input.classList.toggle('is-invalid', !!message);
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
    var errEl = label.querySelector('.field-error');
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

  function validate() {
    var firstInvalid = null;
    var check = function (input, message) {
      setFieldError(input, message);
      if (message && !firstInvalid) firstInvalid = input;
    };

    check(nameInput, nameInput.value.trim() ? '' : 'Please enter your name.');

    var emailValue = emailInput.value.trim();
    check(emailInput, emailValue && emailValid(emailValue) ? '' : 'Enter a valid email.');

    check(typeEl, typeEl.value ? '' : 'Please pick a request type.');

    check(detailsInput, detailsInput.value.trim() ? '' : 'Please describe your enquiry.');

    if (firstInvalid) firstInvalid.focus();
    return !firstInvalid;
  }

  // Clear a field's error as soon as the user edits it.
  form.addEventListener('input', function (event) {
    if (event.target.matches('input, select, textarea') && event.target.classList.contains('is-invalid')) {
      setFieldError(event.target, '');
    }
  });

  // ── Submit: POST to the backend worker ──
  form.addEventListener('submit', function (event) {
    event.preventDefault();

    if (!validate()) return;

    var data = {
      name: nameInput.value.trim(),
      email: emailInput.value.trim(),
      type: typeEl.value,
      details: detailsInput.value.trim(),
    };

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    // The Worker opens a GitHub issue and returns { success, issueUrl }.
    fetch('https://backend.srmwebring.workers.dev/enquiry', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
      .then(function (response) {
        return response.json();
      })
      .then(function (result) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit request';
        if (result.success) {
          showStatus('Submitted! ' + result.issueUrl, false);
        } else {
          showStatus('Error: ' + (result.error || 'Something went wrong.'), true);
        }
      })
      .catch(function (error) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit request';
        showStatus('Network error: ' + error.message, true);
      });
  });

  function showStatus(message, isError) {
    output.textContent = message;
    output.className = 'join-status is-visible ' + (isError ? 'is-error' : 'is-success');
  }
})();
