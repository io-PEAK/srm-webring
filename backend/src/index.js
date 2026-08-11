// ============================================================
// backend/src/index.js — SRM WebRing Cloudflare Worker
// Join/update PR creation, enquiry issues, badge uploads, and
// per-member KV state. Requires GitHub token, KV and R2 bindings.
// ============================================================

const BADGE_MAX_BYTES = 1024 * 1024; // 1 MB

const RING_BASE = 'https://io-PEAK.github.io/srm-webring';

// 1x1 transparent GIF served as the widget tracking pixel.
const WIDGET_PIXEL = 'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

const BADGE_SIGNATURES = [
  { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], type: 'image/png' },
  { ext: 'gif', magic: [0x47, 0x49, 0x46, 0x38], type: 'image/gif' },
  { ext: 'jpg', magic: [0xff, 0xd8, 0xff], type: 'image/jpeg' },
];

// Return { ext, type } when the uploaded bytes start with a known image
// signature, otherwise null. Extensions are never trusted — magic bytes are.
function detectBadgeType(bytes) {
  for (const sig of BADGE_SIGNATURES) {
    if (bytes.length < sig.magic.length) continue;
    let ok = true;
    for (let i = 0; i < sig.magic.length; i++) {
      if (bytes[i] !== sig.magic[i]) { ok = false; break; }
    }
    if (ok) return sig;
  }
  return null;
}

// Deterministic key per site so re-uploading a badge overwrites the same
// object and the stored URL never has to change (no git churn on updates).
function badgeKey(site, ext) {
  const clean = String(site || '').replace(/\/+$/, '').toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < clean.length; i++) {
    h ^= clean.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 'badges/' + (h >>> 0).toString(36) + '.' + ext;
}

// Shared body parsing for join/update: accept multipart (file upload) or a
// plain JSON payload (older clients). Returns { fields, fileBytes }.
async function parseBadgeForm(request) {
  const type = (request.headers.get('content-type') || '').toLowerCase();
  if (type.startsWith('multipart/form-data')) {
    const form = await request.formData();
    const fields = {};
    for (const key of form.keys()) {
      const value = form.get(key);
      if (typeof value === 'string') fields[key] = value;
    }
    const file = form.get('badgeFile');
    let fileBytes = null;
    if (file && typeof file.arrayBuffer === 'function') {
      fileBytes = new Uint8Array(await file.arrayBuffer());
    }
    return { fields, fileBytes };
  }
  const fields = await request.json();
  return { fields, fileBytes: null };
}


// ── College email verification (magic link) ──────────
// Joins are two-step: the form posts /join, which emails a one-time
// verification link to the @srmist.edu.in address. Clicking the link
// (GET /join/verify) commits the member to git and opens the PR.
const SRM_COLLEGE_DOMAIN = '@srmist.edu.in';
const PENDING_TTL_SECONDS = 60 * 60; // link expires after 1 hour
// How long the "this site was verified" marker lives so the join page can
// auto-advance a member to step 3 even if they verify from another tab.
const VERIFIED_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const RESEND_COOLDOWN_MS = 60 * 1000;

function generateToken() {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
}

function normSite(s) {
  return String(s || '').replace(/\/+$/, '').toLowerCase();
}

function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function httpError(message, status = 500) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function sendVerifyEmail(env, to, name, verifyUrl) {
        const senderEmail = env.SENDER_EMAIL;
  const htmlContent = emailShell(`
    <p>Hi <strong>${escapeHtml(name)}</strong>,</p>
    <p>You submitted a request to join the SRM WebRing. To confirm this SRM email address belongs to you, click the button below:</p>
    <p style="text-align:center;margin:28px 0;">
      <a href="${verifyUrl}" style="display:inline-block;padding:12px 28px;background:#0c4da2;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;">Verify my college email</a>
    </p>
    ${emailCallout('#0c4da2', 'Your verification link is valid for <strong>1 hour</strong> and works only once.')}
    <p style="color:#7a8aa5;font-size:.85rem;word-break:break-all;">Or open this link: <a href="${verifyUrl}" style="color:#6fb3ff;">${verifyUrl}</a></p>
  `);
  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: {
      'api-key': env.BREVO_API_KEY,
      'content-type': 'application/json',
      'accept': 'application/json',
    },
    body: JSON.stringify({
      sender: { email: senderEmail },
      to: [{ email: to, name }],
      subject: 'Verify your email to join SRM WebRing',
      htmlContent,
    }),
  });
  return { ok: res.ok, json: await res.json() };
}

function pageShell(title, bodyHtml, linkHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | SRM WebRing</title>
  <link rel="icon" href="${RING_BASE}/img/tree_yellow.png" type="image/png">
  <style>
    @font-face{font-family:'Minecraft';font-style:normal;font-weight:400;font-display:swap;src:url('${RING_BASE}/fonts/Minecraft.ttf') format('truetype');}
    @font-face{font-family:'Space Grotesk';font-style:normal;font-weight:300 700;font-display:swap;src:url('https://fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2') format('woff2');}
    @font-face{font-family:'Space Mono';font-style:normal;font-weight:400;font-display:swap;src:url('https://fonts.gstatic.com/s/spacemono/v17/i7dPIFZifjKcF5UAWdDRYEF8RXi4EwQ.woff2') format('woff2');}
    @font-face{font-family:'Space Mono';font-style:normal;font-weight:700;font-display:swap;src:url('https://fonts.gstatic.com/s/spacemono/v17/i7dMIFZifjKcF5UAWdDRaPpZUFWaHi6WZ3Q.woff2') format('woff2');}
    :root{color-scheme:light;--bg:#f5f3f0;--fg:#1c1917;--fg-muted:#706b66;--border:#e0ddd8;--accent:#0c4da2;--accent-2:#c8a008;--panel-alt:#efece7;--fg-on-accent:#fff;--font-body:'Space Grotesk',-apple-system,BlinkMacSystemFont,sans-serif;--font-mono:'Space Mono',ui-monospace,monospace;}
    @media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:#13120f;--fg:#e0ddd8;--fg-muted:#928c86;--border:#2a2927;--accent:#0c4da2;--accent-2:#c8a008;--panel-alt:#1a1918;--fg-on-accent:#fff;}}
    *{box-sizing:border-box;margin:0;padding:0;}
    body{background:var(--bg);color:var(--fg);font-family:var(--font-body);min-height:100vh;min-height:100dvh;overflow-x:hidden;}
    .back-link{position:fixed;top:1rem;left:1rem;z-index:50;background:var(--accent);color:var(--fg-on-accent);padding:1rem 2.5rem;border-radius:6px;font-family:var(--font-body);font-size:1.1rem;font-weight:700;text-decoration:none;box-shadow:0 2px 8px rgba(0,0,0,.18);transition:opacity .2s;}
    .back-link:hover{opacity:.85;color:var(--fg-on-accent);}
    main{max-width:720px;margin:0 auto;padding:8rem 2rem 4rem;min-height:100dvh;}
    h1{font-family:'Minecraft',sans-serif;font-weight:400;font-size:clamp(2rem,5vw,4rem);letter-spacing:0;line-height:1;text-transform:uppercase;margin-bottom:1rem;}
    h1 span{color:var(--accent-2);}
    p{color:var(--fg-muted);line-height:1.6;margin-bottom:1rem;max-width:38rem;}
    h2{font-family:'Minecraft',sans-serif;font-weight:400;letter-spacing:0;margin:1.6rem 0 .6rem;font-size:1.4rem;}
    code{font-family:var(--font-mono);}
    .widget-code{position:relative;background:var(--panel-alt);border:1px solid var(--border);border-radius:10px;padding:1rem 1rem .5rem;margin-bottom:1.2rem;max-width:38rem;}
    .widget-code pre{margin:0;overflow-x:auto;font-family:var(--font-mono);font-size:.78rem;line-height:1.55;color:var(--fg);white-space:pre;padding-top:1.6rem;}
    .widget-copy{position:absolute;top:.5rem;right:.5rem;background:var(--accent);color:var(--fg-on-accent);border:none;border-radius:6px;padding:.4rem .9rem;cursor:pointer;font-family:var(--font-body);font-size:.85rem;font-weight:700;transition:opacity .15s,background .15s;}
    .widget-copy:hover{opacity:.85;}
    .widget-copy.is-copied{background:var(--accent-2);}
    .btn{display:inline-block;margin-top:8px;padding:10px 20px;background:var(--accent);color:var(--fg-on-accent)!important;text-decoration:none;border-radius:999px;font-weight:700;font-family:var(--font-body);transition:opacity .2s;}
    .btn:hover{opacity:.85;}
  </style>
</head>
<body>
  <a class="back-link" href="${RING_BASE}/">&larr; Back to ring</a>
  <main>
    ${bodyHtml}
    ${linkHtml ? `<p style="margin-top:20px;">${linkHtml}</p>` : ''}
  </main>
</body>
</html>`;
}

// Shared notification email layout: centered tree logo header, clean
// typography, and a muted footer. Fully inline-styled because most
// email clients strip <style> tags. The styled name SRM
// is kept only in the header; body copy uses plain "SRM".
function emailShell(bodyHtml) {
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;background:#0b0e14;padding:24px;">
      <div style="max-width:520px;margin:0 auto;background:#141a24;border:1px solid #2a3446;border-radius:12px;padding:32px;color:#aab6c8;font-size:.95rem;line-height:1.55;">
        <div style="text-align:center;padding-bottom:20px;border-bottom:1px solid #2a3446;margin-bottom:24px;">
          <img src="https://io-PEAK.github.io/srm-webring/img/tree_yellow.png" alt="SRM WebRing" style="width:52px;height:47px;display:block;margin:0 auto;">
          <h2 style="color:#c8a008;margin:12px 0 0;font-size:1.3rem;font-weight:700;">SRM WebRing</h2>
        </div>
        ${bodyHtml}
        <p style="margin:24px 0 0;padding-top:16px;border-top:1px solid #2a3446;color:#5a6a85;font-size:.78rem;line-height:1.5;">You received this email because your site is a member of the SRM WebRing. If you didn't expect this, you can ignore it.</p>
      </div>
    </div>
  `;
}

// A highlighted box for key warnings inside an email body.
function emailCallout(color, html) {
  return `<div style="background:#1b2130;border:1px solid ${color};border-left:4px solid ${color};border-radius:6px;padding:14px 16px;margin:20px 0;">${html}</div>`;
}

function verifiedPage(prUrl) {
  return pageShell(
    'Verified',
    `<h1>Verified<span>!</span></h1>
     <p>Your SRM college email is verified. Your webring request has been submitted as a pull request and will be reviewed shortly.</p>
     <p>Head back to the join page, we've moved you to the final step where your widget code is ready to copy.</p>
     <p><a class="btn" href="${RING_BASE}/join.html">Back to the join form &rarr;</a></p>`,
    prUrl
      ? `<a class="btn" href="${prUrl}" target="_blank" rel="noopener noreferrer">View pull request &rarr;</a>`
      : ''
  );
}

function verifyErrorPage() {
  return pageShell(
    'Link invalid',
    `<h1>Link invalid or expired</h1>
     <p>This verification link is invalid or has already been used. Please submit the join form again to receive a fresh link.</p>`,
    `<a class="btn" href="https://io-PEAK.github.io/srm-webring/join.html">Back to the join form</a>`
  );
}

// Check whether a website is already registered by someone other than the
// member identified by `existingSite` (the site this college email owns).
async function isSiteTaken(ghHeaders, OWNER, REPO, website, existingSite) {
  const fileRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/data/members.json`, { headers: ghHeaders });
  const fileData = await fileRes.json();
  const members = JSON.parse(atob(fileData.content.replace(/\s/g, '')));
  const newSite = normSite(website);
  const existingIndex = existingSite
    ? members.findIndex(m => normSite(m.website) === normSite(existingSite))
    : -1;
  return members.some((m, i) => i !== existingIndex && normSite(m.website) === newSite);
}

// Complete a verified join: store private emails in KV (never git), commit
// the member to a branch, and open a PR.
async function finalizeJoin(env, ghHeaders, OWNER, REPO, entry, emailData, existingSite) {
  // Emails live only in KV (via emailData) — never in the public git payload.
  delete entry.collegeEmail;
  delete entry.personalEmail;

  // 1. Get the current members.json
  const fileRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/data/members.json`, { headers: ghHeaders });
  const fileData = await fileRes.json();
  const cleanBase64 = fileData.content.replace(/\s/g, '');
  const members = JSON.parse(atob(cleanBase64));

  const newSite = normSite(entry.website);
  const existingIndex = existingSite
    ? members.findIndex(m => normSite(m.website) === normSite(existingSite))
    : -1;

  // Prevent a *different* member from registering an already-taken site.
  if (members.some((m, i) => i !== existingIndex && normSite(m.website) === newSite)) {
    throw httpError('This website URL is already in the webring!', 400);
  }

  const isUpdate = existingIndex >= 0;
  if (isUpdate) {
    members[existingIndex] = entry;
  } else {
    members.push(entry);
  }

  // Private email mapping lives only in KV, never in git.
  await env.EMAIL_STORE.put(entry.website, JSON.stringify(emailData));
  const collegeKey = 'college:' + emailData.collegeEmail.toLowerCase().trim();
  await env.EMAIL_STORE.put(collegeKey, JSON.stringify({ website: entry.website }));
  if (isUpdate && existingSite && normSite(existingSite) !== newSite) {
    await env.EMAIL_STORE.delete(existingSite);
  }

  const BRANCH_NAME = `join-${entry.name.replace(/\s+/g, '-').toLowerCase()}-${Date.now()}`;

  // 2. Create a branch from main
  const mainRef = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/main`, { headers: ghHeaders }).then(r => r.json());
  await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({ ref: `refs/heads/${BRANCH_NAME}`, sha: mainRef.object.sha }),
  });

  // 3. Commit members.json on that branch
  await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/data/members.json`, {
    method: 'PUT',
    headers: ghHeaders,
    body: JSON.stringify({
      message: `${isUpdate ? 'Update' : 'Add'} ${entry.name} ${isUpdate ? 'in' : 'to'} webring`,
      content: btoa(JSON.stringify(members, null, 2)),
      sha: fileData.sha,
      branch: BRANCH_NAME,
    }),
  });

  // 4. Add the member's city to data/cities.json when it's new (best effort)
  const cityKey = entry.location.toLowerCase().trim();
  if (cityKey) {
    try {
      const citiesRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/data/cities.json`, { headers: ghHeaders });
      if (citiesRes.ok) {
        const citiesFile = await citiesRes.json();
        const cities = JSON.parse(atob(citiesFile.content.replace(/\s/g, '')));
        if (!cities[cityKey]) {
          const geo = await geocodeLocation(entry.location);
          if (geo) {
            cities[cityKey] = geo;
            await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/data/cities.json`, {
              method: 'PUT',
              headers: ghHeaders,
              body: JSON.stringify({
                message: `Add ${geo.name} to cities`,
                content: btoa(JSON.stringify(cities, null, 2)),
                sha: citiesFile.sha,
                branch: BRANCH_NAME,
              }),
            });
          }
        }
      }
    } catch (err) {
      // cities update is best-effort; the member entry still succeeds
    }
  }

  // 5. Open the PR
  const prRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/pulls`, {
    method: 'POST',
    headers: ghHeaders,
    body: JSON.stringify({
      title: `${isUpdate ? 'Update request' : 'Join request'}: ${entry.name}`,
      head: BRANCH_NAME,
      base: 'main',
      body: `Automated ${isUpdate ? 'update' : 'join'} request.\n\n${JSON.stringify(entry, null, 2)}`,
    }),
  });
  const pr = await prRes.json();
  return { prUrl: pr.html_url, website: entry.website };
}

// Best-effort geocode of a free-typed location via Nominatim (OSM).
// Returns { lat, lng, name, state } or null when it can't resolve.
async function geocodeLocation(location) {
  try {
    const q = encodeURIComponent(String(location).trim() + ', India');
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&countrycodes=in&accept-language=en`,
      { headers: { 'User-Agent': 'srm-webring-worker/1.0' } }
    );
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || !body.length) return null;
    const first = body[0];
    const parts = (first.display_name || '').split(',').map(s => s.trim()).filter(Boolean);
    return {
      lat: parseFloat(first.lat),
      lng: parseFloat(first.lon),
      name: parts[0] || String(location).trim(),
      state: parts.length > 1 ? parts[1] : '',
    };
  } catch (err) {
    return null;
  }
}

// Enquiry type → GitHub label. Kept in sync with the <select> in enquiry.html.
const TYPE_LABELS = {
  'broken-link': 'enquiry-broken-link',
  'grad-date-correction': 'enquiry-grad-date',
  'removal': 'enquiry-removal',
  'badge-change': 'enquiry-badge',
  'other': 'enquiry-other',
};

const TYPE_LABEL_COLORS = {
  'enquiry-broken-link': 'd73a4a',
  'enquiry-grad-date': '0075ca',
  'enquiry-removal': 'cf222e',
  'enquiry-badge': '0e8a16',
  'enquiry-other': '7057ff',
};

// GitHub refuses to create an issue that references a label that doesn't
// exist (422). Make sure each label exists before creating the issue.
async function ensureLabels(headers, labels) {
  const listRes = await fetch(
    `https://api.github.com/repos/io-PEAK/srm-webring/labels`,
    { headers }
  );
  if (!listRes.ok) return;
  const existing = new Set((await listRes.json()).map(l => l.name));
  for (const name of labels) {
    if (existing.has(name)) continue;
    await fetch(`https://api.github.com/repos/io-PEAK/srm-webring/labels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name,
        color: TYPE_LABEL_COLORS[name] || '5319e7',
        description: 'Enquiry type — ' + name,
      }),
    }).catch(() => {});
  }
}

export default {
  async fetch(request, env, ctx) {
    // ── CORS HEADERS ────────────────────────────────
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const OWNER = 'io-PEAK';
    const REPO = 'srm-webring';
    const ghHeaders = {
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'srm-webring-worker',
    };

    try {
      // ── MEMBERS API (public read of data/members.json) ──
      if (url.pathname === '/api/members') {
        if (request.method !== 'GET') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        const ghRes = await fetch(
          `https://api.github.com/repos/${OWNER}/${REPO}/contents/data/members.json`,
          { headers: ghHeaders }
        );
        if (!ghRes.ok) {
          return new Response(JSON.stringify({ error: 'Failed to read members.json' }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const file = await ghRes.json();
        const cleaned = (file.content || '').replace(/\s/g, '');
        const decoded = atob(cleaned);
        const members = JSON.parse(decoded);
        return new Response(JSON.stringify(members), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=60',
            ...corsHeaders,
          },
        });
      }

      // ── BADGE SERVE (public read of KV) ──────────────
      if (url.pathname.startsWith('/badges/')) {
        if (request.method !== 'GET') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        const key = decodeURIComponent(url.pathname.slice(1));
        const value = await env.BADGE_STORE.get(key, 'arrayBuffer');
        if (value === null) {
          return new Response('Not found', { status: 404, headers: corsHeaders });
        }
        const contentType =
          key.endsWith('.png') ? 'image/png' :
          key.endsWith('.gif') ? 'image/gif' :
          key.endsWith('.jpg') ? 'image/jpeg' :
          'application/octet-stream';
        return new Response(value, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=3600',
            ...corsHeaders,
          },
        });
      }

      // ── WIDGET PING (public tracking pixel, loaded from member sites) ──
      // The widget snippet includes a 1x1 GIF that pings this route whenever
      // a visitor loads a member's page, proving the widget is installed.
      if (url.pathname === '/widget') {
        if (request.method !== 'GET') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        const site = (url.searchParams.get('site') || '').trim();
        if (!site) {
          return new Response('Missing site parameter', { status: 400, headers: corsHeaders });
        }
        const key = 'widget:site:' + normSite(site);
        const now = new Date().toISOString();
        let prev = null;
        try { prev = JSON.parse(await env.EMAIL_STORE.get(key)); } catch (e) { prev = null; }
        await env.EMAIL_STORE.put(key, JSON.stringify({
          lastSeen: now,
          count: ((prev && Number(prev.count)) || 0) + 1,
        }));
        return new Response(base64ToBytes(WIDGET_PIXEL), {
          headers: {
            'Content-Type': 'image/gif',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            ...corsHeaders,
          },
        });
      }

      // ── ENQUIRY ROUTE ──────────────────────────────
      if (url.pathname === '/enquiry') {
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        const data = await request.json();

        const name = String(data.name || '').trim();
        const email = String(data.email || '').trim();
        const type = String(data.type || '').trim();
        const details = String(data.details || '').trim();
        if (!name || !email || !type || !details) {
          return new Response(JSON.stringify({ error: 'All fields are required.' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const label = TYPE_LABELS[type] || 'enquiry';
        await ensureLabels(ghHeaders, ['enquiry', label]);

        const issueRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/issues`, {
          method: 'POST',
          headers: ghHeaders,
          body: JSON.stringify({
            title: `Enquiry: ${type} — ${name}`,
            body: `**Type:** ${type}\n**Name:** ${name}\n**Email:** ${email}\n**Details:**\n${details}`,
            labels: ['enquiry', label],
          }),
        });
        const issue = await issueRes.json();

        return new Response(JSON.stringify({ success: true, issueUrl: issue.html_url }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ── EMAIL LOOKUP ROUTE (GitHub Actions only) ──
      if (url.pathname === '/email-lookup') {
        if (request.method !== 'GET') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        
        // Authorization check
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.LOOKUP_SECRET}`) {
          return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }

        const site = url.searchParams.get('site');
        if (!site) {
          return new Response('Missing site parameter', { status: 400, headers: corsHeaders });
        }

        const rawData = await env.EMAIL_STORE.get(site);
        if (!rawData) {
          return new Response(JSON.stringify({ error: 'Not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        return new Response(rawData, {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ── WIDGET STATUS ROUTE (GitHub Actions only) ──
      // Returns the recorded widget pings for a site so the health-check
      // workflows can enforce widget installation.
      if (url.pathname === '/widget-status') {
        if (request.method !== 'GET') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.LOOKUP_SECRET}`) {
          return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }

        const site = url.searchParams.get('site');
        if (!site) {
          return new Response('Missing site parameter', { status: 400, headers: corsHeaders });
        }

        const rawData = await env.EMAIL_STORE.get('widget:site:' + normSite(site));
        if (!rawData) {
          return new Response(JSON.stringify({ lastSeen: null, count: 0 }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        return new Response(rawData, {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ── EMAIL NOTIFICATION ROUTE (Actions or Admin) ──
      if (url.pathname === '/notify') {
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        // Authorization check
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || authHeader !== `Bearer ${env.LOOKUP_SECRET}`) {
          return new Response('Unauthorized', { status: 401, headers: corsHeaders });
        }

        const { site, type } = await request.json();
        if (!site || !type) {
          return new Response('Missing parameters', { status: 400, headers: corsHeaders });
        }

        // Get student emails from KV
        const rawData = await env.EMAIL_STORE.get(site);
        if (!rawData) {
          return new Response(JSON.stringify({ success: false, error: 'Email details not found in KV store' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const member = JSON.parse(rawData);
        const collegeEmail = member.collegeEmail;
        const personalEmail = member.personalEmail;
        const recipientName = member.name;

        // Email content templates
        let subject = '';
        let htmlContent = '';

        const senderEmail = env.SENDER_EMAIL;

        if (type === 'warning') {
          subject = '[ACTION REQUIRED] Your site is unreachable, SRM WebRing';
          htmlContent = emailShell(`
            <p>Hi <strong>${recipientName}</strong>,</p>
            <p>During our automated checks, we were unable to reach your website: <a href="${site}" style="color:#6fb3ff;">${site}</a>.</p>
            <p>Your site has been marked as <strong>hidden</strong> and is temporarily excluded from the WebRing navigation and directory to keep things running smoothly for visitors.</p>
            ${emailCallout('#ffcc00', '<strong>[WARNING]</strong> Your site has been down for <strong>10 days</strong>. If it remains unreachable for 5 more days (15 days total), your entry will be permanently removed from the WebRing.')}
            <p>Once your website is back online, our 3-day health check will automatically restore your site to the active ring. No manual action is needed.</p>
          `);
        } else if (type === 'removal') {
          subject = 'Website removed from SRM WebRing';
          htmlContent = emailShell(`
            <p>Hi <strong>${recipientName}</strong>,</p>
            <p>Your website (<a href="${site}" style="color:#6fb3ff;">${site}</a>) has been unreachable for <strong>15 days</strong>.</p>
            <p>As per the webring rules, your entry has been permanently removed from <code>members.json</code>.</p>
            <p>If this was a mistake or your site is back up, you are welcome to submit a new join request at the site: <a href="https://io-PEAK.github.io/srm-webring/join.html" style="color:#6fb3ff;">Join Again</a>.</p>
          `);
        } else if (type === 'graduation') {
          subject = 'Congratulations on your graduation, SRM WebRing';
          htmlContent = emailShell(`
            <p>Hi <strong>${recipientName}</strong>,</p>
            <p>Happy graduation! We noticed your graduation date grace period (30 days) has passed.</p>
            <p>To keep the ring active for current students, your site (<a href="${site}" style="color:#6fb3ff;">${site}</a>) has been automatically removed from the directory.</p>
            <p>Thank you for being part of the SRM WebRing community. We wish you all the best in your post-college journey!</p>
          `);
        } else if (type === 'widget-warning') {
          subject = '[ACTION REQUIRED] Your webring widget is missing, SRM WebRing';
          htmlContent = emailShell(`
            <p>Hi <strong>${recipientName}</strong>,</p>
            <p>Your site (<a href="${site}" style="color:#6fb3ff;">${site}</a>) is listed in the webring, but our checks can't find the webring widget on it.</p>
            ${emailCallout('#ffcc00', '<strong>[WARNING]</strong> The widget is what makes your site part of the ring navigation. If it is still missing in <strong>9 days</strong> (30 days total), your entry will be removed.')}
            <p>You can get the code from the join page after verifying your email. Paste it just before <code>&lt;/body&gt;</code> on your homepage.</p>
          `);
        } else if (type === 'widget-removal') {
          subject = 'Removed from SRM WebRing, widget missing';
          htmlContent = emailShell(`
            <p>Hi <strong>${recipientName}</strong>,</p>
            <p>Your site (<a href="${site}" style="color:#6fb3ff;">${site}</a>) has not had the webring widget installed for <strong>30 days</strong>, so your entry has been removed from <code>members.json</code>.</p>
            <p>You're welcome to rejoin anytime, add the widget to your site and submit a new join request at <a href="https://io-PEAK.github.io/srm-webring/join.html" style="color:#6fb3ff;">Join the ring</a>.</p>
          `);
        } else {
          return new Response('Invalid notification type', { status: 400, headers: corsHeaders });
        }

        // Send email via Brevo REST API
        const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': env.BREVO_API_KEY,
            'content-type': 'application/json',
            'accept': 'application/json'
          },
          body: JSON.stringify({
            sender: { email: senderEmail },
            to: [
              { email: collegeEmail, name: recipientName },
              { email: personalEmail, name: recipientName }
            ],
            subject: subject,
            htmlContent: htmlContent
          })
        });

        const brevoResult = await brevoRes.json();

        return new Response(JSON.stringify({ success: brevoRes.ok, brevo: brevoResult }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ── UPDATE BADGE ROUTE (overwrite KV value for an existing site) ──
      if (url.pathname === '/update-badge') {
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        const { fields, fileBytes } = await parseBadgeForm(request);
        const site = (fields.site || '').trim();
        if (!site) {
          return new Response(JSON.stringify({ success: false, error: 'Missing site parameter' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        if (!fileBytes) {
          return new Response(JSON.stringify({ success: false, error: 'Missing badgeFile' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        const sig = detectBadgeType(fileBytes);
        if (!sig) {
          return new Response(JSON.stringify({ success: false, error: 'Badge must be a PNG, GIF, or JPEG image' }), {
            status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        if (fileBytes.byteLength > BADGE_MAX_BYTES) {
          return new Response(JSON.stringify({ success: false, error: 'Badge is too large (max 1 MB)' }), {
            status: 413, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
        const key = badgeKey(site, sig.ext);
        await env.BADGE_STORE.put(key, fileBytes);
        return new Response(JSON.stringify({ success: true, badgeUrl: url.origin + '/' + key }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // ── JOIN ROUTE ────────────────────────────────
      // Step 1 of verification: validate the form and email a one-time
      // verification link to the @srmist.edu.in address. The PR is only
      // opened after the link is clicked (GET /join/verify).
      if (url.pathname === '/join') {
        if (request.method !== 'POST') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }

        const { fields: rawFields, fileBytes } = await parseBadgeForm(request);

        const entry = {
          name: (rawFields.name || '').trim(),
          website: (rawFields.website || '').trim(),
          program: (rawFields.program || '').trim(),
          gradDate: (rawFields.gradDate || '').trim(),
          collegeEmail: (rawFields.collegeEmail || '').trim().toLowerCase(),
          personalEmail: (rawFields.personalEmail || '').trim(),
          location: (rawFields.location || '').trim(),
        };

        if (!entry.name || !entry.website || !entry.program || !entry.location) {
          return new Response(JSON.stringify({ success: false, error: 'Name, website, program, and location are required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        if (!entry.collegeEmail || !entry.personalEmail) {
          return new Response(JSON.stringify({ success: false, error: 'Emails are required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Only SRM college addresses qualify.
        if (!entry.collegeEmail.endsWith(SRM_COLLEGE_DOMAIN)) {
          return new Response(JSON.stringify({ success: false, error: `Only ${SRM_COLLEGE_DOMAIN} college emails are accepted` }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // Validate badge bytes up front so a bad file is rejected before an
        // email is sent. The actual upload happens on verification.
        if (fileBytes) {
          const sig = detectBadgeType(fileBytes);
          if (!sig) {
            return new Response(JSON.stringify({ success: false, error: 'Badge must be a PNG, GIF, or JPEG image' }), {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
          if (fileBytes.byteLength > BADGE_MAX_BYTES) {
            return new Response(JSON.stringify({ success: false, error: 'Badge is too large (max 1 MB)' }), {
              status: 413,
              headers: { 'Content-Type': 'application/json', ...corsHeaders }
            });
          }
        } else if (rawFields.badge && typeof rawFields.badge === 'string') {
          entry.badge = rawFields.badge.trim();
        }

        const emailData = {
          name: entry.name,
          collegeEmail: entry.collegeEmail,
          personalEmail: entry.personalEmail
        };

        // Fail fast if the site is already registered by someone else.
        const collegeKey = 'college:' + emailData.collegeEmail.toLowerCase().trim();
        const existingMappingRaw = await env.EMAIL_STORE.get(collegeKey);
        const existingSite = existingMappingRaw ? (JSON.parse(existingMappingRaw).website || null) : null;
        if (await isSiteTaken(ghHeaders, OWNER, REPO, entry.website, existingSite)) {
          return new Response(JSON.stringify({ success: false, error: 'This website URL is already in the webring!' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        // One pending link per site; don't spam the inbox on double-submits.
        const siteKey = 'pending:join:' + normSite(entry.website);
        const now = Date.now();
        const existingPendingRaw = await env.EMAIL_STORE.get(siteKey);
        if (existingPendingRaw) {
          let rec = null;
          try { rec = JSON.parse(existingPendingRaw); } catch (e) { rec = null; }
          if (rec && now - rec.sentAt < RESEND_COOLDOWN_MS) {
            return new Response(JSON.stringify({
              success: true,
              pending: true,
              message: 'A verification link was already sent — check your college inbox.'
            }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }

        const token = generateToken();
        const pending = {
          token,
          sentAt: now,
          entry,
          emailData,
          fileBytesB64: fileBytes ? bytesToBase64(fileBytes) : null,
        };
        await env.EMAIL_STORE.put(siteKey, JSON.stringify(pending), { expirationTtl: PENDING_TTL_SECONDS });

        const verifyUrl = url.origin + '/join/verify?token=' + token + '&site=' + encodeURIComponent(entry.website);
        const brevo = await sendVerifyEmail(env, entry.collegeEmail, entry.name, verifyUrl);
        if (!brevo.ok) {
          await env.EMAIL_STORE.delete(siteKey);
          const brevoDetail = brevo.json
            ? String(brevo.json.message || brevo.json.code || JSON.stringify(brevo.json))
            : '';
          return new Response(JSON.stringify({
            success: false,
            error: 'Could not send the verification email. Please try again.' + (brevoDetail ? ' (' + brevoDetail + ')' : ''),
          }), {
            status: 502,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        return new Response(JSON.stringify({
          success: true,
          pending: true,
          message: `Verification link sent to ${entry.collegeEmail}.`
        }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // ── JOIN STATUS ROUTE (polled by the join page while on step 2) ──
      // Tells the join page whether the verification link for a site has
      // been clicked so it can auto-advance to step 3.
      if (url.pathname === '/join/status') {
        if (request.method !== 'GET') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        const site = (url.searchParams.get('site') || '').trim();
        if (!site) {
          return new Response(JSON.stringify({ error: 'Missing site' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const norm = normSite(site);
        const verifiedRaw = await env.EMAIL_STORE.get('verified:join:' + norm);
        if (verifiedRaw) {
          let prUrl = null;
          try { prUrl = JSON.parse(verifiedRaw).prUrl || null; } catch (e) { /* noop */ }
          return new Response(JSON.stringify({ verified: true, prUrl }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }
        const pendingRaw = await env.EMAIL_STORE.get('pending:join:' + norm);
        return new Response(JSON.stringify({ verified: false, pending: !!pendingRaw }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // ── JOIN VERIFY ROUTE (magic link opened from the email) ──
      if (url.pathname === '/join/verify') {
        if (request.method !== 'GET') {
          return new Response('Method not allowed', { status: 405, headers: corsHeaders });
        }
        const token = (url.searchParams.get('token') || '').trim();
        const site = (url.searchParams.get('site') || '').trim();
        const siteKey = 'pending:join:' + normSite(site);
        const raw = await env.EMAIL_STORE.get(siteKey);
        if (!token || !site || !raw) {
          return new Response(verifyErrorPage(), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
          });
        }
        const pending = JSON.parse(raw);
        if (pending.token !== token) {
          return new Response(verifyErrorPage(), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
          });
        }

        const entry = pending.entry;
        if (pending.fileBytesB64) {
          const fileBytes = base64ToBytes(pending.fileBytesB64);
          const sig = detectBadgeType(fileBytes);
          if (!sig) {
            await env.EMAIL_STORE.delete(siteKey);
            return new Response(verifyErrorPage(), {
              headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
            });
          }
          const key = badgeKey(entry.website, sig.ext);
          await env.BADGE_STORE.put(key, fileBytes);
          entry.badge = url.origin + '/' + key;
        }

        const collegeKey = 'college:' + pending.emailData.collegeEmail.toLowerCase().trim();
        const existingMappingRaw = await env.EMAIL_STORE.get(collegeKey);
        const existingSite = existingMappingRaw ? (JSON.parse(existingMappingRaw).website || null) : null;

        let result;
        try {
          result = await finalizeJoin(env, ghHeaders, OWNER, REPO, entry, pending.emailData, existingSite);
        } catch (err) {
          await env.EMAIL_STORE.delete(siteKey);
          return new Response(verifyErrorPage(), {
            headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
          });
        }
        await env.EMAIL_STORE.delete(siteKey);

        // Marker the join page polls so it can auto-advance to step 3.
        await env.EMAIL_STORE.put(
          'verified:join:' + normSite(result.website),
          JSON.stringify({ prUrl: result.prUrl, verifiedAt: Date.now() }),
          { expirationTtl: VERIFIED_TTL_SECONDS }
        );

        return new Response(verifiedPage(result.prUrl), {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ...corsHeaders },
        });
      }

      // ── CATCH-ALL ──
      // No route matched (e.g. hitting the bare origin). Return a proper 404
      // instead of letting the handler fall off the end, which Cloudflare
      // reports as "Worker threw exception" (error 1101).
      if (url.pathname === '/') {
        return new Response(JSON.stringify({
          service: 'SRM WebRing backend',
          ok: true,
          endpoints: [
            '/api/members',
            '/join',
            '/join/status',
            '/join/verify',
            '/enquiry',
            '/widget',
            '/widget-status',
            '/notify',
            '/email-lookup',
            '/update-badge',
            '/badges/{key}',
          ],
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: err.status || 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};