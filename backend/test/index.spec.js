// ============================================================
// backend/test/index.spec.js — vitest suite for the Worker
// Exercises badge serve/upload and the join route against a
// mocked GitHub API (cloudflare:test pool).
// ============================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { env, SELF, fetchMock } from "cloudflare:test";

function pngBytes() {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02]).buffer;
}

function b64(str) {
  return Buffer.from(str).toString("base64");
}

// Build a multipart join request body.
function joinBody(fields) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

const FIELDS = {
  name: "Shivam",
  website: "https://shivam.example",
  program: "B.Tech CSE",
  gradDate: "15/05/2027",
  collegeEmail: "sn1234@srmist.edu.in",
  personalEmail: "shivam@example.com",
  location: "Delhi",
  badge: "https://badge.example/b.png",
};

// Mock the GitHub API a join request touches. `members` is mutated in place
// after each successful PR to simulate the merged members.json on main.
// `times` is how many join requests the test will make; members.json is GET'd
// twice per cycle (fail-fast site check on /join, then finalize on /verify),
// so interceptors are fully consumed before the afterEach check.
function mockGitHub(members, putBodies, times = 1) {
  const gh = fetchMock.get("https://api.github.com");
  gh.intercept({ path: "/repos/io-PEAK/srm-ncr-webring/contents/data/members.json", method: "GET" })
    .reply(200, () => ({ content: b64(JSON.stringify(members, null, 2)), sha: "file-sha" })).times(2 * times);
  gh.intercept({ path: "/repos/io-PEAK/srm-ncr-webring/git/ref/heads/main", method: "GET" })
    .reply(200, () => ({ object: { sha: "main-sha" } })).times(times);
  gh.intercept({ path: "/repos/io-PEAK/srm-ncr-webring/contents/data/cities.json", method: "GET" })
    .reply(404, () => ({})).times(times);
  gh.intercept({ path: "/repos/io-PEAK/srm-ncr-webring/git/refs", method: "POST" })
    .reply(201, () => ({})).times(times);
  gh.intercept({ path: "/repos/io-PEAK/srm-ncr-webring/contents/data/members.json", method: "PUT" })
    .reply(200, (opts) => {
      const body = JSON.parse(opts.body);
      putBodies.push(body);
      members.splice(0, members.length, ...JSON.parse(Buffer.from(body.content, "base64").toString()));
      return { content: {} };
    }).times(times);
  gh.intercept({ path: "/repos/io-PEAK/srm-ncr-webring/pulls", method: "POST" })
    .reply(201, () => ({ html_url: "https://github.com/io-PEAK/srm-ncr-webring/pull/1" })).times(times);
}

// Mock the Brevo email API (verification links are sent on /join).
function mockBrevo(times) {
  fetchMock.get("https://api.brevo.com")
    .intercept({ path: "/v3/smtp/email", method: "POST" })
    .reply(201, () => ({ messageId: "test-message-id" })).times(times);
}

const normSite = s => String(s).replace(/\/+$/, "").toLowerCase();

async function joinOnly(fields) {
  const res = await SELF.fetch("https://worker.dev/join", { method: "POST", body: joinBody(fields) });
  const data = await res.json();
  return { res, data };
}

async function pendingFor(website) {
  const raw = await env.EMAIL_STORE.get("pending:join:" + normSite(website));
  expect(raw).toBeTruthy();
  return JSON.parse(raw);
}

function verifyLink(pending, website) {
  return "https://worker.dev/join/verify?token=" + pending.token + "&site=" + encodeURIComponent(website);
}

// POST /join once, then open the verification link.
async function joinAndVerify(fields) {
  const { res, data } = await joinOnly(fields);
  expect(res.status).toBe(200);
  expect(data.pending).toBe(true);
  const pending = await pendingFor(fields.website);
  const verify = await SELF.fetch(verifyLink(pending, fields.website));
  return { pending, verify };
}

describe("badge serve route", () => {
  it("returns 404 for a missing badge", async () => {
    const response = await SELF.fetch("https://worker.dev/badges/nope.png");
    expect(response.status).toBe(404);
  });
});

describe("update-badge route", () => {
  it("rejects an uploaded file that is not a real image (magic bytes)", async () => {
    const form = new FormData();
    form.append("site", "https://shivam.example");
    form.append("badgeFile", new File(["<!DOCTYPE html>"], "badge.png", { type: "image/png" }));
    const response = await SELF.fetch("https://worker.dev/update-badge", { method: "POST", body: form });
    expect(response.status).toBe(400);
  });

  it("stores a valid PNG and serves it back with the right content type", async () => {
    const form = new FormData();
    form.append("site", "https://shivam.example");
    form.append("badgeFile", new File([pngBytes()], "badge.png", { type: "image/png" }));
    const response = await SELF.fetch("https://worker.dev/update-badge", { method: "POST", body: form });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const image = await SELF.fetch(body.badgeUrl);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/png");
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect(Array.from(bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it("accepts a GIF (magic bytes 47 49 46 38) and serves it as image/gif", async () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]).buffer;
    const form = new FormData();
    form.append("site", "https://gif.example");
    form.append("badgeFile", new File([gif], "badge.gif", { type: "image/gif" }));
    const response = await SELF.fetch("https://worker.dev/update-badge", { method: "POST", body: form });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.badgeUrl.endsWith(".gif")).toBe(true);

    const image = await SELF.fetch(body.badgeUrl);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/gif");
    const bytes = new Uint8Array(await image.arrayBuffer());
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x47, 0x49, 0x46, 0x38]);
  });

  it("re-uploading a badge for the same site rewrites the old one (same URL, new bytes)", async () => {
    const firstPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xaa, 0xbb]).buffer;
    const secondPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xcc, 0xdd]).buffer;

    const upload = (bytes) => {
      const form = new FormData();
      form.append("site", "https://rewrite.example");
      form.append("badgeFile", new File([bytes], "badge.png", { type: "image/png" }));
      return SELF.fetch("https://worker.dev/update-badge", { method: "POST", body: form });
    };

    const first = await (await upload(firstPng)).json();
    const second = await (await upload(secondPng)).json();
    expect(first.badgeUrl).toBe(second.badgeUrl);

    const served = new Uint8Array(await (await SELF.fetch(first.badgeUrl)).arrayBuffer());
    expect(Array.from(served.slice(8, 10))).toEqual([0xcc, 0xdd]);
  });
});

describe("join route (magic link verification)", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  it("emails a link and only opens a PR once the link is clicked", async () => {
    const members = [];
    const putBodies = [];
    mockGitHub(members, putBodies, 1);
    mockBrevo(1);

    const join = await joinOnly(FIELDS);
    expect(join.res.status).toBe(200);
    expect(join.data.pending).toBe(true);
    expect(join.data.message).toContain("srmist.edu.in");

    // No PR before verification.
    expect(members).toHaveLength(0);
    expect(putBodies).toHaveLength(0);

    const pending = await pendingFor(FIELDS.website);
    const verify = await SELF.fetch(verifyLink(pending, FIELDS.website));
    expect(verify.status).toBe(200);
    const page = await verify.text();
    expect(page).toContain("Verified!");
    expect(page).toContain("https://github.com/io-PEAK/srm-ncr-webring/pull/1");
    // The verified page hands the member their widget code (step 3).
    expect(page).toContain("srm-ring-widget");
    expect(page).toContain("/widget?site=https%3A%2F%2Fshivam.example");
    expect(page).toContain("img/tree_yellow.png");

    expect(members).toHaveLength(1);
    expect(members[0].name).toBe("Shivam");
    expect(members[0].collegeEmail).toBeUndefined();
    expect(members[0].personalEmail).toBeUndefined();
    expect(putBodies[0].message).toBe("Add Shivam to webring");
  });

  it("re-joining with the same college email overwrites the existing entry", async () => {
    const members = [];
    const putBodies = [];
    mockGitHub(members, putBodies, 2);
    mockBrevo(2);

    await joinAndVerify(FIELDS);
    expect(members).toHaveLength(1);

    const updated = await joinAndVerify({
      ...FIELDS,
      name: "Shivam Kumar",
      website: "https://shivam-dev.example",
      location: "Noida",
    });
    expect(updated.verify.status).toBe(200);

    // Still one member, with the new details — not a duplicate.
    expect(members).toHaveLength(1);
    expect(members[0].name).toBe("Shivam Kumar");
    expect(members[0].website).toBe("https://shivam-dev.example");
    expect(members[0].collegeEmail).toBeUndefined();
    expect(putBodies[1].message).toBe("Update Shivam Kumar in webring");
  });

  it("re-joining with the same college email and same site updates in place (not rejected)", async () => {
    const members = [];
    const putBodies = [];
    mockGitHub(members, putBodies, 2);
    mockBrevo(2);

    await joinAndVerify(FIELDS);
    const again = await joinAndVerify({ ...FIELDS, program: "B.Tech ECE" });

    expect(again.verify.status).toBe(200);
    expect(members).toHaveLength(1);
    expect(members[0].program).toBe("B.Tech ECE");
  });

  it("uploads the badge only after a verified join and serves it back", async () => {
    const members = [];
    const putBodies = [];
    mockGitHub(members, putBodies, 1);
    mockBrevo(1);

    const form = new FormData();
    for (const [k, v] of Object.entries(FIELDS)) {
      if (k !== "badge") form.append(k, v);
    }
    form.append("badgeFile", new File([pngBytes()], "badge.png", { type: "image/png" }));

    const res = await SELF.fetch("https://worker.dev/join", { method: "POST", body: form });
    const data = await res.json();
    expect(data.pending).toBe(true);
    expect(members).toHaveLength(0);

    const pending = await pendingFor(FIELDS.website);
    const verify = await SELF.fetch(verifyLink(pending, FIELDS.website));
    expect(verify.status).toBe(200);

    expect(members[0].badge).toMatch(/^https:\/\/worker\.dev\/badges\/.+\.png$/);
    const served = await SELF.fetch(members[0].badge);
    expect(served.status).toBe(200);
    expect(served.headers.get("content-type")).toBe("image/png");
  });

  it("rejects a non-SRM college email before sending anything", async () => {
    const res = await SELF.fetch("https://worker.dev/join", {
      method: "POST",
      body: joinBody({ ...FIELDS, collegeEmail: "shivam@gmail.com" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("srmist.edu.in");
  });

  it("rejects a different person registering an already-taken site", async () => {
    const gh = fetchMock.get("https://api.github.com");
    gh.intercept({ path: "/repos/io-PEAK/srm-ncr-webring/contents/data/members.json", method: "GET" })
      .reply(200, () => ({ content: b64(JSON.stringify([{ name: "Existing", website: "https://shivam.example" }], null, 2)), sha: "file-sha" }));

    const res = await SELF.fetch("https://worker.dev/join", {
      method: "POST",
      body: joinBody({ ...FIELDS, name: "Intruder", collegeEmail: "other@srmist.edu.in" }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("already in the webring");
  });

  it("rejects a join missing required fields", async () => {
    const res = await SELF.fetch("https://worker.dev/join", {
      method: "POST",
      body: joinBody({ name: "No Website" }),
    });
    expect(res.status).toBe(400);
  });

  it("shows the error page for an invalid or expired verification link", async () => {
    const res = await SELF.fetch(
      "https://worker.dev/join/verify?token=bogus-token&site=https%3A%2F%2Fshivam.example"
    );
    expect(res.status).toBe(200);
    const page = await res.text();
    expect(page).toContain("Link invalid or expired");
  });

  it("consumes the pending link after verification", async () => {
    mockGitHub([], [], 1);
    mockBrevo(1);

    const { pending } = await joinAndVerify(FIELDS);
    expect(pending).toBeTruthy();

    // Second click of the same link is rejected (single use).
    const again = await SELF.fetch(verifyLink(pending, FIELDS.website));
    expect(again.status).toBe(200);
    expect(await again.text()).toContain("Link invalid or expired");
  });
});

describe("widget tracking", () => {
  it("records a ping from the tracking pixel and returns a 1x1 GIF", async () => {
    // The pool persists KV across runs; clear the key so the count
    // assertion is deterministic.
    await env.EMAIL_STORE.delete("widget:site:https://shivam.example");

    const res = await SELF.fetch("https://worker.dev/widget?site=https://shivam.example");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/gif");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes[0]).toBe(0x47); // 'G'
    expect(bytes[1]).toBe(0x49); // 'I'

    const rec = JSON.parse(await env.EMAIL_STORE.get("widget:site:https://shivam.example"));
    expect(rec.count).toBe(1);
    expect(rec.lastSeen).toBeTruthy();

    await SELF.fetch("https://worker.dev/widget?site=https://shivam.example");
    const rec2 = JSON.parse(await env.EMAIL_STORE.get("widget:site:https://shivam.example"));
    expect(rec2.count).toBe(2);
  });

  it("rejects a widget ping without a site", async () => {
    const res = await SELF.fetch("https://worker.dev/widget");
    expect(res.status).toBe(400);
  });

  it("widget-status requires the lookup secret", async () => {
    const res = await SELF.fetch("https://worker.dev/widget-status?site=https://shivam.example");
    expect(res.status).toBe(401);
  });

  it("widget-status returns the recorded ping for a known site", async () => {
    await env.EMAIL_STORE.delete("widget:site:https://status.example");
    await SELF.fetch("https://worker.dev/widget?site=https://status.example");
    const res = await SELF.fetch("https://worker.dev/widget-status?site=https://status.example", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(1);
    expect(body.lastSeen).toBeTruthy();
  });

  it("widget-status returns empty for an unknown site", async () => {
    const res = await SELF.fetch("https://worker.dev/widget-status?site=https://nope.example", {
      headers: { Authorization: "Bearer test-secret" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ lastSeen: null, count: 0 });
  });
});

describe("notify route", () => {
  beforeEach(() => {
    fetchMock.activate();
    fetchMock.disableNetConnect();
  });
  afterEach(() => {
    fetchMock.assertNoPendingInterceptors();
    fetchMock.deactivate();
  });

  async function seedMember(site) {
    await env.EMAIL_STORE.put(site, JSON.stringify({
      name: "Shivam",
      collegeEmail: "sn1234@srmist.edu.in",
      personalEmail: "shivam@example.com",
    }));
  }

  it("rejects unauthenticated requests", async () => {
    const res = await SELF.fetch("https://worker.dev/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ site: "https://shivam.example", type: "widget-warning" }),
    });
    expect(res.status).toBe(401);
  });

  it("sends a widget-warning email", async () => {
    await seedMember("https://shivam.example");
    mockBrevo(1);
    const res = await SELF.fetch("https://worker.dev/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret" },
      body: JSON.stringify({ site: "https://shivam.example", type: "widget-warning" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it("sends a widget-removal email and rejects unknown types", async () => {
    await seedMember("https://shivam.example");
    mockBrevo(1);
    const res = await SELF.fetch("https://worker.dev/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret" },
      body: JSON.stringify({ site: "https://shivam.example", type: "widget-removal" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);

    const bad = await SELF.fetch("https://worker.dev/notify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-secret" },
      body: JSON.stringify({ site: "https://shivam.example", type: "nope" }),
    });
    expect(bad.status).toBe(400);
  });
});
