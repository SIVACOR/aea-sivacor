// Bare-bones browser harness for driving the SIVACOR submit UI against the
// local deploy-dev stack. No test framework, no repo dependencies -- just
// playwright plus the helpers that every scenario ends up needing.
//
// See ./README.md for prerequisites and usage.

import { createRequire } from 'module';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const require = createRequire(import.meta.url);

/** playwright is intentionally not a dependency of this repo; find it wherever. */
function loadPlaywright() {
    const candidates = [
        'playwright',
        path.join(os.homedir(), 'node_modules/playwright/index.js'),
        '/usr/lib/node_modules/playwright/index.js',
    ];
    for (const c of candidates) {
        try {
            return require(c);
        } catch {
            /* try next */
        }
    }
    throw new Error(
        'playwright not found. Install it somewhere importable, e.g.\n' +
            '  npm i -g playwright && npx playwright install chromium'
    );
}

/**
 * Which browser binary to drive. Playwright's own chromium download is a
 * ~150 MB prerequisite this harness does not need -- any recent Chrome speaks
 * the same CDP -- so the system browser is the default. Override with
 * SIVACOR_E2E_CHROME, or set it empty to use playwright's bundled build.
 */
export const CHROME =
    process.env.SIVACOR_E2E_CHROME ?? '/usr/bin/google-chrome';

export const DOMAIN = process.env.SIVACOR_E2E_DOMAIN || 'local.xarthisius.xyz';
export const UI = `https://submit.${DOMAIN}`;
export const API = `https://girder.${DOMAIN}/api/v1`;
export const ADMIN = { login: 'admin', password: 'arglebargle123' }; // deploy-dev/setup_girder.py
/**
 * A plain, non-admin account, created on first use.
 *
 * This harness has only ever driven the admin, which cannot see any rule an
 * admin bypasses -- the worker-size gate being the first of them (site admins
 * may pick a gated rung by design, so to them nothing is ever gated). Testing
 * the closed side of anything needs a user who is not one.
 */
export const MEMBER = {
    login: 'e2euser',
    password: 'e2e-password-123',
    email: 'e2e@example.com',
    firstName: 'E2E',
    lastName: 'User',
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Instrumentation injected before any app code runs. Exposes window.__probe so
 * scenarios can assert on *behaviour* (leaked pollers, redundant fetches)
 * rather than on what the DOM happens to say.
 */
export const PROBE_INIT = `
window.__probe = {
  intervalsCreated: [],       // every JOB_POLLING_INTERVAL timer the monitor opens
  liveIntervals: new Set(),   // ...that have not been cleared (leak detector)
  jobPolls: {},               // jobId -> number of GET /job/<id>
  metricLoads: 0,             // performance_data_stage_* lookups
};
const _si = window.setInterval, _ci = window.clearInterval;
window.setInterval = function (fn, ms, ...rest) {
  const id = _si.call(window, fn, ms, ...rest);
  if (ms === 5000) { window.__probe.intervalsCreated.push(id); window.__probe.liveIntervals.add(id); }
  return id;
};
window.clearInterval = function (id) { window.__probe.liveIntervals.delete(id); return _ci.call(window, id); };
const _fetch = window.fetch;
window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  const m = url.match(/\\/job\\/([0-9a-f]{24})(?:\\?|$)/);
  if (m) window.__probe.jobPolls[m[1]] = (window.__probe.jobPolls[m[1]] || 0) + 1;
  if (url.includes('performance_data_stage_')) window.__probe.metricLoads++;
  return _fetch.call(this, input, init);
};
`;

/** Girder token for the deploy-dev admin. OAuth is not usable headlessly. */
export async function getToken() {
    const basic = Buffer.from(`${ADMIN.login}:${ADMIN.password}`).toString('base64');
    const r = await fetch(`${API}/user/authentication`, {
        headers: { Authorization: `Basic ${basic}` },
    });
    if (!r.ok) throw new Error(`auth failed: ${r.status} (is the wt stack up?)`);
    return (await r.json()).authToken.token;
}

/** Girder token for MEMBER, registering the account if it does not exist yet. */
export async function getMemberToken(adminToken) {
    const basic = Buffer.from(`${MEMBER.login}:${MEMBER.password}`).toString('base64');
    const auth = () =>
        fetch(`${API}/user/authentication`, { headers: { Authorization: `Basic ${basic}` } });
    let r = await auth();
    if (!r.ok) {
        const qs = new URLSearchParams({
            login: MEMBER.login,
            email: MEMBER.email,
            firstName: MEMBER.firstName,
            lastName: MEMBER.lastName,
            password: MEMBER.password,
            admin: 'false',
        });
        // Created by the admin rather than self-registered, so it lands
        // `enabled` whatever core.registration_policy says.
        const created = await fetch(`${API}/user?${qs}`, {
            method: 'POST',
            headers: { 'Girder-Token': adminToken },
        });
        if (!created.ok) {
            throw new Error(`could not create ${MEMBER.login}: ${created.status} ${await created.text()}`);
        }
        r = await auth();
        if (!r.ok) throw new Error(`auth as ${MEMBER.login} failed: ${r.status}`);
    }
    return (await r.json()).authToken.token;
}

export async function apiGet(endpoint, token) {
    const r = await fetch(`${API}${endpoint}`, { headers: { 'Girder-Token': token } });
    if (!r.ok) throw new Error(`GET ${endpoint} -> ${r.status}`);
    return r.json();
}

/**
 * Writes a Girder setting. deploy-dev seeds no worker-size catalogue, so it
 * falls through to the plugin's single-rung default -- and a picker with one
 * option cannot test picking. Scenarios that need a choice install a ladder
 * here and put the original back when they are done.
 */
export async function setSetting(token, key, value) {
    // Query parameters, not a request body. Girder's PUT /system/setting takes
    // key and value as params, and a urlencoded body it never reads comes back
    // **200 having changed nothing** -- which is how this helper first shipped,
    // and a scenario whose setup silently no-ops reports the old behaviour as a
    // failure of the new code.
    const qs = new URLSearchParams({ key, value: JSON.stringify(value) });
    const r = await fetch(`${API}/system/setting?${qs}`, {
        method: 'PUT',
        headers: { 'Girder-Token': token },
    });
    if (!r.ok) throw new Error(`PUT setting ${key} -> ${r.status} ${await r.text()}`);
    // Read back rather than trust the 200, for the reason above. Key order is
    // not preserved through Mongo, so compare canonically.
    const canon = (v) =>
        JSON.stringify(v, (_, x) =>
            x && typeof x === 'object' && !Array.isArray(x)
                ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]]))
                : x
        );
    const stored = await apiGet(`/system/setting?key=${encodeURIComponent(key)}`, token);
    if (canon(stored) !== canon(value)) {
        throw new Error(`setting ${key} did not take. stored: ${canon(stored)}`);
    }
    return stored;
}

/** Server-side truth about submissions, for cross-checking what the UI claims. */
export async function listJobs(token, limit = 10) {
    const types = encodeURIComponent(JSON.stringify(['sivacor_submission']));
    return apiGet(`/job?types=${types}&limit=${limit}&sort=created&sortdir=-1`, token);
}

/** Minimal replication package. Built on demand so no binary lives in git. */
export function makePackage(dir = path.join(os.tmpdir(), 'sivacor-e2e')) {
    const zip = path.join(dir, 'package.zip');
    if (fs.existsSync(zip)) return zip;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(new URL('./fixtures/main.R', import.meta.url).pathname, path.join(dir, 'main.R'));
    execFileSync('zip', ['-qj', zip, path.join(dir, 'main.R')]);
    return zip;
}

/**
 * Launch a probed browser already authenticated against the dev stack.
 *
 * Pass `token` to drive somebody other than the admin -- see MEMBER, and
 * getMemberToken for one.
 */
export async function open({ headless = true, probe = true, token: asToken } = {}) {
    const { chromium } = loadPlaywright();
    const token = asToken ?? (await getToken());
    const browser = await chromium.launch({
        headless,
        ...(CHROME ? { executablePath: CHROME } : {}),
    });
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    if (probe) await ctx.addInitScript(PROBE_INIT);
    const page = await ctx.newPage();
    page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
    // ?girderToken= is how the app receives auth post-OAuth; it sticks as a cookie.
    await page.goto(`${UI}/?girderToken=${token}`, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForTimeout(2500);
    return { browser, ctx, page, token, close: () => browser.close() };
}

export const bodyText = (page) => page.evaluate(() => document.body.innerText);

export const readProbe = (page) =>
    page.evaluate(() => ({
        created: window.__probe.intervalsCreated.length,
        live: window.__probe.liveIntervals.size,
        jobPolls: { ...window.__probe.jobPolls },
        metricLoads: window.__probe.metricLoads,
    }));

export async function shownJobId(page) {
    const m = (await bodyText(page)).match(/Job ID:?\s*([0-9a-f]{24})/i);
    return m ? m[1] : null;
}

export async function jobStatus(page) {
    const t = await bodyText(page);
    for (const s of ['SUCCESS', 'ERROR', 'CANCELED', 'RUNNING', 'QUEUED', 'INACTIVE']) {
        if (new RegExp(`\\b${s}\\b`).test(t)) return s;
    }
    return null;
}

export async function waitTerminal(page, timeoutMs = 600000) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const s = await jobStatus(page);
        if (s === 'SUCCESS' || s === 'ERROR' || s === 'CANCELED') return s;
        await sleep(2500);
    }
    return 'TIMEOUT';
}

/** The runner form only exists once the monitor is reset (or on a fresh account). */
export async function resetToRunner(page) {
    // Class, not text: the same control reads "Run New Job" after a success and
    // "Try Again" after a failure, and matching on wording silently no-ops on
    // the error path -- leaving you on the monitor wondering where the form went.
    let b = page.locator('button.new-job-button').first();
    if (!(await b.count())) {
        b = page.locator('button', { hasText: /run a new job|new job|new submission/i }).first();
    }
    if (await b.count()) {
        await b.scrollIntoViewIfNeeded();
        await b.click();
        await page.waitForTimeout(1200);
    }
    return page.locator('#file-input').count().then((n) => n > 0);
}

/**
 * Drive the full runner form. Returns the job id from the submit_job RESPONSE,
 * not from the DOM -- when the monitor is the thing under test, the DOM is not
 * a trustworthy source for which job was actually created.
 */
export async function submitJob(page, opts = {}) {
    const {
        zip = makePackage(),
        image = 'rocker/r-ver',
        tag = '4.6.1',
        mainFile = 'main.R',
        // Leave the step fields alone -- use when an imported workflow has
        // already filled them and overwriting would defeat the point.
        skipForm = false,
        // Worker size to pick. null leaves whatever the picker defaulted to,
        // which is also the only option on a stack with a one-rung catalogue.
        memoryGb = null,
    } = opts;

    await page.setInputFiles('#file-input', zip);
    await page.click('button.upload-button');
    await page.waitForFunction(() => /Upload Successful/i.test(document.body.innerText), null, {
        timeout: 180000,
    });
    if (!skipForm) {
        await page.selectOption('select[id^="image-select-"]', image);
        await page.waitForTimeout(400);
        await page.selectOption('select[id^="tag-select-"]', tag);
        await page.fill('input[id^="execution-file-"]', mainFile);
    }
    // Outside the skipForm guard: an imported workflow may name a size, and a
    // scenario that wants a different one has to be able to say so. The picker
    // is absent when the server has no catalogue endpoint, which must not be a
    // failure here.
    if (memoryGb !== null && (await page.locator('#worker-size-select').count())) {
        await page.selectOption('#worker-size-select', String(memoryGb));
    }

    const responded = page.waitForResponse(
        (r) => r.url().includes('/sivacor/submit_job') && r.request().method() === 'POST',
        { timeout: 120000 }
    );
    await page.click('button.run-button');
    const res = await responded;
    const body = await res.json().catch(() => null);
    // What the form actually put on the wire, which is the only place a picker
    // that renders correctly but sends nothing can be caught.
    let sent = null;
    try {
        sent = JSON.parse(res.request().postData() ?? 'null');
    } catch {
        /* not JSON; leave null */
    }
    if (res.status() === 200) {
        await page.waitForFunction(() => /Job ID/i.test(document.body.innerText), null, {
            timeout: 120000,
        });
    }
    return { status: res.status(), id: body?._id ?? null, body, sent };
}

/** Sample which job the monitor displays, once a second. Catches state that
 *  reverts a few seconds after an action -- the class of bug you cannot see in
 *  a single assertion right after the click. */
export async function watchShownJob(page, seconds = 25) {
    const timeline = [];
    for (let i = 0; i < seconds; i++) {
        timeline.push(await shownJobId(page));
        await sleep(1000);
    }
    return timeline;
}

/** Does a section blank out and come back? (metrics flicker detector) */
export async function watchForFlicker(page, marker = 'Performance Metrics', seconds = 25) {
    return page.evaluate(
        async ([mk, secs]) => {
            let blanks = 0,
                sawFilled = false;
            for (let i = 0; i < secs * 4; i++) {
                if (document.body.innerText.includes(mk)) sawFilled = true;
                else if (sawFilled) blanks++;
                await new Promise((r) => setTimeout(r, 250));
            }
            return { sawFilled, blanks };
        },
        [marker, seconds]
    );
}
