// ============================================================
// scripts/geocode-cities.js — one-off maintenance script
// Run with `node`, NOT shipped to the site. Builds data/cities.json
// from a state -> [city] list using the Nominatim geocoder.
// ============================================================
'use strict';

// One-time geocoder: builds data/cities.json from a state->[city] source list.
// Uses Nominatim (OpenStreetMap) at ~1 req/sec (their usage policy), with
// "city, state, India" for disambiguation. Resumable: progress + results are
// written incrementally, so re-running picks up where it left off.
//
// Usage:
//   node scripts/geocode-cities.js [input.json] [out.json]
//
// Defaults:
//   input = ~/github/unihaul/frontend/src/data/indiaCities.json
//   out   = data/cities.json

const fs = require('fs');
const path = require('path');

const INPUT = process.argv[2] || path.join(process.env.HOME, 'github/unihaul/frontend/src/data/indiaCities.json');
const OUT = process.argv[3] || path.join(__dirname, '..', 'data', 'cities.json');
const PROGRESS = OUT + '.progress';
const FAILED = OUT + '.failed';
const SAVE_EVERY = 25;
const MIN_DELAY_MS = 1100;
const USER_AGENT = 'srm-webring-geocoder/1.0 (https://github.com/io-PEAK/srm-webring)';

function loadOr(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(rel, 'utf8')); }
  catch (e) { return fallback; }
}

// ── Geocode a city via Nominatim ──
async function geocode(city, state) {
  const q = encodeURIComponent(`${city}, ${state}, India`);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&format=json&limit=1&accept-language=en&countrycodes=in`;
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  // Rate-limited (429): back off 5s, then retry — Nominatim enforces ~1 req/s.
  if (res.status === 429) { await new Promise(r => setTimeout(r, 5000)); return geocode(city, state); }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (!body || !body.length) return null;
  const first = body[0];
  return {
    lat: parseFloat(first.lat),
    lng: parseFloat(first.lon),
    display: first.display_name.split(',').slice(0, 2).join(', ')
  };
}

// ── Main: resumable build of data/cities.json ──
async function main() {
  const byState = loadOr(INPUT, null);
  if (!byState) throw new Error('Cannot read input JSON: ' + INPUT);

  const cities = loadOr(OUT, {});
  const progress = loadOr(PROGRESS, { done: [], failed: [] });
  const done = new Set(progress.done);
  const failed = new Set(progress.failed);

  const tasks = [];
  for (const state of Object.keys(byState)) {
    for (const raw of byState[state]) {
      const key = String(raw).trim().toLowerCase();
      if (!key || done.has(key) || failed.has(key) || cities[key]) continue;
      tasks.push({ key, name: String(raw).trim(), state });
    }
  }

  console.log(`[geocode] ${tasks.length} pending (${done.size} done, ${failed.size} failed)`);
  let sinceSave = 0;

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    let entry = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { entry = await geocode(t.name, t.state); break; }
      catch (err) { console.warn(`[geocode] retry ${t.name}: ${err.message}`); await new Promise(r => setTimeout(r, 3000)); }
    }
    if (entry) {
      cities[t.key] = { lat: entry.lat, lng: entry.lng, name: t.name, state: t.state };
      progress.done.push(t.key);
    } else {
      progress.failed.push(t.key);
    }
    if (++sinceSave >= SAVE_EVERY || i === tasks.length - 1) {
      fs.writeFileSync(OUT, JSON.stringify(cities, null, 2));
      fs.writeFileSync(PROGRESS, JSON.stringify(progress));
      fs.writeFileSync(FAILED, JSON.stringify(progress.failed, null, 2));
      console.log(`[geocode] ${i + 1}/${tasks.length} — ${Object.keys(cities).length} resolved`);
      sinceSave = 0;
    }
    await new Promise(r => setTimeout(r, MIN_DELAY_MS));
  }

  console.log(`[geocode] DONE. ${Object.keys(cities).length} cities, ${progress.failed.length} failed.`);
}

main().catch(err => { console.error(err); process.exit(1); });
