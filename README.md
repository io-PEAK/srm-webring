<div align="center">

<div align="center">
  <img src="https://github.com/io-PEAK/srm-webring/blob/main/img/tree_yellow.png" alt="Project Logo" width="200">
  <h1>SRM WebRing</h1>
</div>

A public webring for SRM University students to showcase portfolios, blogs, and personal projects connected in a ring, mapped across India, and kept alive by automation.

<img src="images/screenshots/splash.png" alt="SRM WebRing splash panel — hero with the India map" width="760">

</div>

<div align="center">

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare%20Workers-F38020?logo=cloudflare&logoColor=white&style=for-the-badge)
![GitHub Pages](https://img.shields.io/badge/GitHub%20Pages-222222?logo=github&logoColor=white&style=for-the-badge)
![GitHub Actions](https://img.shields.io/badge/GitHub%20Actions-2088FF?logo=githubactions&logoColor=white&style=for-the-badge)
![Vanilla JS](https://img.shields.io/badge/Vanilla%20JS-F7DF1E?logo=javascript&logoColor=000&style=for-the-badge)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?logo=html5&logoColor=white&style=for-the-badge)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?logo=css3&logoColor=white&style=for-the-badge)

</div>

**<img src="images/icons/screenshots.svg" width="20" height="20" valign="middle"/> &nbsp; Screenshots**<br/>

|                                                                                                                                                             |                                                                                                                       |
| :---------------------------------------------------------------------------------------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------------------------------------: |
| <img src="images/screenshots/directory.png" alt="Searchable member directory with interactive ring map"> <br> _Searchable directory & interactive ring map_ |   <img src="images/screenshots/badge.png" alt="88×31 animated GIF badge generator"> <br> _Animated badge generator_   |
|                       <img src="images/screenshots/join.png" alt="Join the ring form"> <br> _Join / update form with widget snippet_                        | <img src="images/screenshots/splash.png" alt="Splash panel with animated India map"> <br> _Animated India map splash_ |

**<img src="images/icons/features.svg" width="20" height="20" valign="middle"/> &nbsp; Features**<br/>

| | |
|:---:|:---:|
| **<img src="images/icons/carousel.svg" width="20" height="20" valign="middle"/> &nbsp; 3D panel carousel**<br/>A full-screen CSS 3D ring of five panels (splash, about, directory, explorer, join) navigated by dots, drag/swipe, and keyboard. Panels are addressable by hash for deep links. | **<img src="images/icons/map.svg" width="20" height="20" valign="middle"/> &nbsp; Animated India map**<br/>Every member is pinned onto an India SVG with animated connection lines. City coordinates are pre-resolved into `data/cities.json`. |
| **<img src="images/icons/search.svg" width="20" height="20" valign="middle"/> &nbsp; Searchable directory**<br/>A paginated member table with live search, kept in sync with an interactive ring map you can pan and zoom. | **<img src="images/icons/arrows.svg" width="20" height="20" valign="middle"/> &nbsp; Live site explorer**<br/>Browse member sites in an embedded live preview with a "click to interact" overlay and prev / next / random navigation. |
| **<img src="images/icons/badge.svg" width="20" height="20" valign="middle"/> &nbsp; Animated badge generator**<br/>An 88×31 GIF editor with metallic shimmer, glitch scan, and typewriter presets, a custom frame strip, and per-frame delay. | **<img src="images/icons/dataflow.svg" width="20" height="20" valign="middle"/> &nbsp; Automated onboarding**<br/>The join form emails a one-time verification link to the member's `@srmist.edu.in` address; clicking it makes the Worker open a pull request that GitHub Actions validates and auto-merges. Rejoining with the same college email updates your existing entry instead of duplicating it. |
| **<img src="images/icons/watch.svg" width="20" height="20" valign="middle"/> &nbsp; Automated health monitoring**<br/>Scheduled workflows probe every member site, hide down members, email warnings, and remove entries after the 15-day grace period. The member widget carries a 1x1 pixel that pings the Worker, so a daily workflow can enforce installation — warning at day 21, removal at day 30. | **<img src="images/icons/lock.svg" width="20" height="20" valign="middle"/> &nbsp; Privacy by design**<br/>Personal emails are stored only in Cloudflare KV and are stripped from the public `members.json`. Uploads are validated by magic bytes, never by file extension. |

**<img src="images/icons/techstack.svg" width="20" height="20" valign="middle"/> &nbsp; Tech Stack**<br/>

| Layer        | Technology                                                                                                                                 |
| :----------- | :----------------------------------------------------------------------------------------------------------------------------------------- |
| **Frontend** | Static HTML5, CSS3 (custom properties + `prefers-color-scheme` dark mode, 3D transforms), vanilla JavaScript — no build step, no framework |
| **Fonts**    | Space Grotesk & Space Mono (self-hosted woff2), Minecraft (bundled locally) for headings                                                   |
| **Backend**  | Cloudflare Workers (Wrangler 4, `nodejs_compat`), Cloudflare KV for email mappings and uploaded badges                                     |
| **APIs**     | GitHub REST API (pull requests, issues, labels, file contents), Brevo SMTP (email), Nominatim/OpenStreetMap (geocoding)                    |
| **CI / CD**  | GitHub Actions — join-PR validation, site health checks, graduated-member cleanup                                                          |
| **Testing**  | Vitest with the `@cloudflare/vitest-pool-workers` pool (tests run in a real Workers runtime)                                               |

**<img src="images/icons/architecture.svg" width="20" height="20" valign="middle"/> &nbsp; System Architecture**<br/>

```
                ┌────────────────────────────────────────────────────────┐
                │                    GitHub Pages                        │
                │   index / join / badge / enquiry / widget  (static)    │
                │   js/*  ── carousel, map, directory, preview, forms    │
                └───────────────┬────────────────────────────────────────┘
                                │  fetch()           ┌──────────────┐
                                ▼                    │  data/       │
                ┌────────────────────────────┐       │  members.json│
                │    Cloudflare Worker       │       │  cities.json │  ◄── source of
                 │  backend.srmwebring.workers.dev│       └──────┬───────┘      truth (repo)
                └──────┬─────────┬───────────┘              │
                       │ KV      │ REST                     │ GitHub REST API
              EMAIL_STORE        ├────────────────────────► │ (PRs / issues / labels /
              BADGE_STORE        │                          │  contents)
                                 │
                                 ▼
                 ┌────────────────────────────┐
                 │        GitHub Actions      │   cron health checks,
                 │   validate-join · check-   │   down-site rechecks,
                 │   sites · recheck-down-    │   graduated cleanup,
                 │   sites · cleanup-graduated│   widget enforcement
                 │   · widget-check           │
                 └───────┬────────────────────┘
                        │ /notify, /email-lookup (Bearer secret)
                        ▼
                ┌────────────────────────────┐
                │        Brevo SMTP          │   warning / removal /
                │                            │   graduation emails
                └────────────────────────────┘
```

**<img src="images/icons/dataflow.svg" width="20" height="20" valign="middle"/> &nbsp; Data Flow**<br/>

**Joining / updating a member**

```
Member → join.html (multipart POST /join) → Worker
   ├─ validates form + badge bytes, checks the site is free
   ├─ stores { collegeEmail, personalEmail } in KV (never committed)
   └─ emails a one-time verification link to the @srmist.edu.in address
        → member clicks it (GET /join/verify?token=…)
             ├─ stores uploaded badge in KV (magic-byte validated, ≤ 1 MB)
             ├─ appends/updates the entry in members.json on a branch
             ├─ geocodes new cities via Nominatim → data/cities.json
             └─ opens a PR → validate-join workflow auto-merges + deletes branch
                  → data/members.json on main updates → site reflects new member
```

**Widget install** — The "Verified" page (and the snippet on the join page) hands the member the widget code, which now embeds a 1x1 pixel pointing at `GET /widget?site=…`. Every visitor load pings the Worker, which records the last ping in KV. A `widget-check` workflow runs daily, reads `widget-status?site=` for each member, warns at day 21 without a ping, and removes the entry at day 30 — both via the `/notify` route (Brevo).

**Enquiries** — `enquiry.html` POSTs to the Worker, which auto-creates the `enquiry-*` label if missing and opens a labeled GitHub issue with the visitor's details.

**Site health** — A `check-sites` workflow probes every site every 3 days and flags unreachable members (`hidden` + `unreachableSince`). A `recheck-down-sites` workflow restores sites that come back, emails a warning at 10 days, and removes the entry at 15 days via the Worker's `/notify` route (Brevo). A `cleanup-graduated` workflow removes members past their graduation date + 30-day grace.

**<img src="images/icons/structure.svg" width="20" height="20" valign="middle"/> &nbsp; Project Structure**<br/>

```
.
├── index.html              # Landing: 3D carousel (splash, about, directory, explore, join)
├── join.html               # Join / update form with city autocomplete + badge upload
├── badge.html              # 88×31 animated GIF badge generator
├── enquiry.html            # Issue-based enquiry form
├── widget.html             # Embeddable prev/next/hub widget for member footers
├── css/
│   ├── style.css           # Shared theme (light/dark), subpage + widget styling
│   └── splash.css          # Carousel, splash, directory, explorer, map styling
├── fonts.css               # Self-hosted font-face declarations
├── fonts/Minecraft.ttf     # Pixel display font for headings
├── js/
│   ├── splash.js           # 3D panel carousel + panelchange/snapto events
│   ├── splash-map.js       # India SVG map with member dots + animated lines
│   ├── directory.js        # Paginated, searchable member directory
│   ├── ring-viz.js         # Interactive ring map (pan / zoom / search sync)
│   ├── preview.js          # Live iframe explorer of member sites
│   ├── members.js          # Shared member loader (worker API → JSON fallback)
│   ├── ring.js             # #member-url?nav=prev|next redirect handler
│   ├── map-arrows.js       # On-map prev / next / random navigation
│   ├── badge.js            # Badge editor + animated GIF export (gif.js)
│   ├── join.js             # Join form validation + step indicator + multipart submit
│   └── enquiry.js          # Enquiry form validation + submit
├── data/
│   ├── members.json        # Public member list (the ring's source of truth)
│   └── cities.json         # Pre-geocoded city → { lat, lng, state } lookup
├── scripts/
│   └── geocode-cities.js   # One-time Nominatim geocoder for cities.json
├── img/                    # SRM logo, tree emblem, collage
├── images/                 # README screenshots + icons
├── backend/                # Cloudflare Worker API
│   ├── src/index.js        # All routes: join, enquiry, badges, members, widget, notify
│   ├── test/index.spec.js  # 22 vitest tests against the Worker
│   ├── vitest.config.js    # Workers-pool vitest config
│   └── wrangler.jsonc      # Worker config + KV namespaces
└── .github/workflows/      # validate-join · check-sites · recheck-down-sites · cleanup-graduated · widget-check
```

**<img src="images/icons/api.svg" width="20" height="20" valign="middle"/> &nbsp; API Reference**<br/>

Base URL: `https://backend.srmwebring.workers.dev`

| Method | Endpoint              | Auth                   | Description                                                                    |
| :----- | :-------------------- | :--------------------- | :----------------------------------------------------------------------------- |
| `GET`  | `/api/members`        | Public                 | Read the active member list from `data/members.json` (GitHub API), cached 60 s |
| `GET`  | `/badges/{key}`       | Public                 | Serve an uploaded member badge from KV (png / gif / jpg)                       |
| `POST` | `/join`               | Public                 | Step 1: validate the form and email a one-time verification link to the `@srmist.edu.in` address. Returns `{ pending: true }` |
| `GET`  | `/join/verify?token=` | Public                 | Step 2: one-time magic link from the email. Verifies ownership, commits the member to a branch, opens the PR, and serves a "Verified" page |
| `POST` | `/enquiry`            | Public                 | Create a labeled GitHub issue from the enquiry form                            |
| `GET`  | `/email-lookup?site=` | `Bearer LOOKUP_SECRET` | Return the stored email record for a site (used by workflows)                  |
| `GET`  | `/widget?site=`       | Public                 | 1x1 tracking pixel embedded in the member widget; records the ping in KV       |
| `GET`  | `/widget-status?site=`| `Bearer LOOKUP_SECRET` | Return the recorded widget ping for a site (used by the widget-check workflow) |
| `POST` | `/notify`             | `Bearer LOOKUP_SECRET` | Send a Brevo email (`warning`, `removal`, `graduation`, `widget-warning`, `widget-removal`) for a site |
| `POST` | `/update-badge`       | Public                 | Overwrite a site's badge in KV from a multipart upload                         |

### Join request fields (`POST /join`)

| Field                                    | Notes                                                                                                                                |
| :--------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `website`, `program`, `location` | Required; `website` must not already belong to another member                                                                        |
| `gradDate`                               | Stored as `DD/MM/YYYY`; validated in the UI                                                                                          |
| `collegeEmail`, `personalEmail`          | Required but **never committed** — stored in KV under `site → {name, collegeEmail, personalEmail}` and `college:<email> → {website}` |
| `badgeFile`                              | Optional image (PNG/GIF/JPEG), magic-byte validated, ≤ 1 MB, stored at `badges/<fnv1a-hash>.<ext>`                                   |

Joining is three-step: `POST /join` only sends the verification link (it never touches git); opening `GET /join/verify?token=...&site=...` from the email finishes the join and serves the widget snippet; the member pastes the widget (which carries the tracking pixel) into their footer. Only `@srmist.edu.in` college emails are accepted — the link is sent to that address, proving the applicant owns it. Links expire after 1 hour, are single-use, and a site can't be double-submitted within 60 s.

**<img src="images/icons/start.svg" width="20" height="20" valign="middle"/> &nbsp; Getting Started**<br/>

### Prerequisites

- **Node.js 22+** and npm
- A **Cloudflare** account with Workers (and the Wrangler CLI)
- A **GitHub** account and repository for the ring
- A **Brevo** (formerly Sendinblue) API key for email notifications

### Frontend (static site)

The site has no build step. Serve the repo root with any static server, or push to GitHub and enable **GitHub Pages**:

```bash
# local development
python3 -m http.server 8000
# open http://localhost:8000
```

> When `GET /api/members` is unavailable (e.g. local static hosting), the frontend automatically falls back to `data/members.json`.

### Backend (Cloudflare Worker)

```bash
cd backend
npm install

# run the test suite (22 tests, real Workers runtime)
npm test

# run the Worker locally
npm run dev

# deploy
npm run deploy
```

Configure the required secrets (never commit them):

```bash
npx wrangler secret put GITHUB_TOKEN   # token with repo scope, for the Worker's GitHub API calls
npx wrangler secret put LOOKUP_SECRET  # shared secret protecting /email-lookup and /notify
npx wrangler secret put BREVO_API_KEY  # Brevo SMTP API key
```

Optional Worker variable `SENDER_EMAIL` (defaults to `webring@srmncr.edu.in`) sets the sender address on notification emails.

### GitHub Actions secrets

`GITHUB_TOKEN` (or a PAT with repo scope) and `LOOKUP_SECRET` are needed by the workflows that validate join PRs and send down-site / graduation / widget emails. Add them under **Settings → Secrets and variables → Actions**.

**<img src="images/icons/watch.svg" width="20" height="20" valign="middle"/> &nbsp; Automated Maintenance**<br/>

| Workflow                     | Trigger                         | Behavior                                                                                               |
| :--------------------------- | :------------------------------ | :----------------------------------------------------------------------------------------------------- |
| **Validate Join PR**         | PR touching `data/members.json` | Fails on duplicate site URLs or missing required fields; auto-merges and deletes the branch on success |
| **Check Member Sites**       | `0 6 */3 * *` + manual          | Probes every site (8 s timeout); restores up sites, flags unreachable ones `hidden`                    |
| **Recheck Down Sites**       | `0 6 */2 * *` + manual          | Restores recovered sites; emails a warning at day 10; removes the entry at day 15                      |
| **Check Widget Installation**| `0 2 * * *` + manual            | Reads each member's widget ping; warns at day 21 without one; removes the entry at day 30             |
| **Remove Graduated Members** | `0 0 * * *` + manual            | Removes members past `gradDate` + 30-day grace and sends a graduation email                            |

**<img src="images/icons/security.svg" width="20" height="20" valign="middle"/> &nbsp; Security**<br/>

- **Email privacy** — college and personal emails live only in Cloudflare KV. They are deleted from the join payload before it is committed to the repository.
- **Upload validation** — badge files are checked against known PNG/GIF/JPEG magic bytes (extension is never trusted) and capped at 1 MB.
- **Secret routes** — `/email-lookup` and `/notify` require a `Bearer LOOKUP_SECRET` header; tokens and API keys are stored as Wrangler/Workflow secrets, not in source.
- **Email-verified joins** — only `@srmist.edu.in` college addresses are accepted, and the one-time verification link sent there proves the applicant owns the inbox before any git changes are made. Links are single-use and expire after 1 hour.
- **Site-ownership checks** — a join request cannot claim a URL already owned by another member; rejoining by college email updates only the existing entry.

**<img src="images/icons/check.svg" width="20" height="20" valign="middle"/> &nbsp; Testing**<br/>

```bash
cd backend
npm test
```

The suite (22 tests in `backend/test/index.spec.js`) runs through `@cloudflare/vitest-pool-workers`, so each test executes against the real Workers runtime with the `wrangler.jsonc` bindings, including the KV namespaces and the GitHub/Brevo/geocode fetches, which are mocked per test.

---
