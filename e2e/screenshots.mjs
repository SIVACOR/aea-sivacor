/**
 * screenshots.mjs — regenerate the screenshots used by docs.sivacor.org.
 *
 * Not a test: it asserts nothing and exits 0 even if a shot looks wrong. It
 * drives the same deploy-dev stack the other harnesses use and writes PNGs
 * straight into ../../docs/docs/images/.
 *
 *   node e2e/screenshots.mjs             # every phase
 *   node e2e/screenshots.mjs run failed  # named phases only
 *
 * Phases: login, run, advanced, failed, waiting
 *
 * Two things differ from a real production session and are compensated for
 * here, because otherwise the shots would be quietly wrong:
 *
 *  - deploy-dev enables globus AND orcid; production enables globus only
 *    (deploy-sivacor/setup_girder.py:108). The `login` phase flips the Girder
 *    setting, shoots, and flips it back in a finally block.
 *  - a local worker is always up, so "Waiting for a worker" never appears. The
 *    `waiting` phase scales wt_local_worker to 0, shoots, and scales it back.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
    open,
    submitJob,
    resetToRunner,
    openAdvanced,
    getMemberToken,
    waitTerminal,
    API,
    UI,
    ADMIN,
    sleep,
} from './lib.mjs';

const OUT = fileURLToPath(new URL('../../docs/docs/images/', import.meta.url));
const phases = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['login', 'run', 'advanced', 'failed', 'waiting'];
const want = (p) => phases.includes(p);

// Docs screenshots are viewed inline in a book theme; 1280 wide at DPR 2 keeps
// text crisp without producing enormous files.
const VIEWPORT = { width: 1280, height: 900 };
const shots = [];

async function shot(target, name) {
    const file = path.join(OUT, name);
    await target.screenshot({ path: file, animations: 'disabled' });
    const kb = Math.round(fs.statSync(file).size / 1024);
    shots.push(`${name} (${kb} KB)`);
    console.log(`  ✓ ${name} (${kb} KB)`);
}

/**
 * Dismiss the cookie notice. It is fixed to the bottom of the viewport and
 * overlaps whatever is down there — it clipped the seventh download card before
 * this existed. Harmless if already dismissed.
 */
async function dismissCookies(page) {
    const b = page.locator('button[aria-label="Dismiss cookie notice"]');
    if (await b.count()) {
        await b.first().click().catch(() => {});
        await page.waitForTimeout(400);
    }
}

/** A section screenshot, padded a little so it doesn't look sheared. */
async function shotOf(page, selector, name) {
    const el = page.locator(selector).first();
    if (!(await el.count())) {
        console.log(`  ! ${name}: no match for ${selector} — skipped`);
        return false;
    }
    await el.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await shot(el, name);
    return true;
}

/**
 * One shot covering several elements at once, clipped to their union.
 *
 * For the run button and the hint that says why it is grey (#43): they are
 * siblings with no wrapper of their own, and either alone misses the point --
 * a grey button with no reason, or a reason with nothing to attach it to.
 */
async function shotUnion(page, selectors, name, pad = 8) {
    const boxes = [];
    for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (!(await el.count())) {
            console.log(`  ! ${name}: no match for ${sel} — skipped`);
            return false;
        }
        await el.scrollIntoViewIfNeeded();
        boxes.push(await el.boundingBox());
    }
    await page.waitForTimeout(400);
    const fresh = [];
    for (const sel of selectors) fresh.push(await page.locator(sel).first().boundingBox());
    const use = fresh.every(Boolean) ? fresh : boxes;
    const x = Math.min(...use.map((b) => b.x)) - pad;
    const y = Math.min(...use.map((b) => b.y)) - pad;
    const clip = {
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.max(...use.map((b) => b.x + b.width)) - x + pad,
        height: Math.max(...use.map((b) => b.y + b.height)) - y + pad,
    };
    const file = path.join(OUT, name);
    await page.screenshot({ path: file, clip, animations: 'disabled' });
    const kb = Math.round(fs.statSync(file).size / 1024);
    shots.push(`${name} (${kb} KB)`);
    console.log(`  ✓ ${name} (${kb} KB)`);
    return true;
}

async function girderToken() {
    const res = await fetch(`${API}/user/authentication`, {
        headers: { Authorization: 'Basic ' + Buffer.from(`${ADMIN.login}:${ADMIN.password}`).toString('base64') },
    });
    return (await res.json()).authToken.token;
}

async function setSetting(key, value, token) {
    const body = new URLSearchParams({ key, value: JSON.stringify(value) });
    const res = await fetch(`${API}/system/setting`, {
        method: 'PUT',
        headers: { 'Girder-Token': token, 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
    });
    if (!res.ok) throw new Error(`setting ${key} failed: ${res.status} ${await res.text()}`);
}

function makeFailingPackage() {
    const dir = path.join(os.tmpdir(), 'sivacor-e2e-fail');
    const zip = path.join(dir, 'package.zip');
    if (fs.existsSync(zip)) return zip;
    fs.mkdirSync(dir, { recursive: true });
    // A realistic failure: the file-not-found error the FAQ documents.
    fs.writeFileSync(
        path.join(dir, 'main.R'),
        'cat("loading data\\n")\ndata <- read.csv("data/raw/gs4.csv")\ncat("never reached\\n")\n'
    );
    execFileSync('zip', ['-qj', zip, path.join(dir, 'main.R')]);
    return zip;
}

function swarm(args) {
    return execFileSync('docker', args, { encoding: 'utf8' }).trim();
}

// ---------------------------------------------------------------- login page
async function phaseLogin() {
    console.log('\n[login] provider list is server-driven — pinning to globus only');
    const token = await girderToken();
    const { browser, close } = await open({ headless: true });
    try {
        await setSetting('oauth.providers_enabled', ['globus'], token);
        // A context with no girderToken cookie is a logged-out visitor.
        // Shorter than VIEWPORT: the sign-in card is small, and a 900px-tall
        // shot is mostly empty page.
        const ctx = await browser.newContext({
            ignoreHTTPSErrors: true,
            viewport: { width: 1280, height: 640 },
            deviceScaleFactor: 2,
        });
        const page = await ctx.newPage();
        await page.goto(UI, { waitUntil: 'networkidle', timeout: 120000 });
        await page.waitForFunction(() => /Sign In/i.test(document.body.innerText), null, { timeout: 60000 });
        await dismissCookies(page);
        await page.waitForTimeout(1200);
        await shot(page, 'sivacor-login.png');
        await ctx.close();
    } finally {
        await setSetting('oauth.providers_enabled', ['globus', 'orcid'], token).catch((e) =>
            console.log('  ! FAILED to restore providers_enabled:', e.message)
        );
        console.log('  · restored providers_enabled = [globus, orcid]');
        await close();
    }
}

// ------------------------------------------------- upload → run → downloads
async function phaseRun() {
    console.log('\n[run] upload, configure, submit, wait for success');
    const { page, close } = await open({ headless: true });
    try {
        await page.setViewportSize(VIEWPORT);
        // { advanced: false }: the shots have to show the form as a user
        // first meets it, and since #43 that is with Advanced folded.
        await resetToRunner(page, { advanced: false });
        await dismissCookies(page);
        await page.waitForTimeout(800);
        await shot(page, 'sivacor-upload-page.png');

        // Grey, with its reason, on an empty form (#43). Taken here because
        // "before anything is uploaded" is the only moment it exists.
        await shotUnion(
            page,
            ['button.run-button', '.run-blocked-hint'],
            'sivacor-run-disabled.png'
        );

        // Upload only, so the success state and the Delete Uploaded File button show.
        const zip = path.join(os.tmpdir(), 'sivacor-e2e', 'package.zip');
        await page.setInputFiles('#file-input', fs.existsSync(zip) ? zip : (await import('./lib.mjs')).makePackage());
        await page.click('button.upload-button');
        await page.waitForFunction(() => /Upload Successful/i.test(document.body.innerText), null, { timeout: 180000 });
        await page.waitForTimeout(700);
        await shot(page, 'sivacor-upload-successful.png');

        // One configured step, with the import panel visible above it.
        await page.selectOption('select[id^="image-select-"]', 'rocker/r-ver');
        await page.waitForTimeout(400);
        await page.selectOption('select[id^="tag-select-"]', '4.6.1');
        await page.fill('input[id^="execution-file-"]', 'main.R');
        await page.waitForTimeout(500);
        await shotOf(page, '.config-section, form, .runner-card', 'sivacor-image-choice-chained.png');

        // A second step, to illustrate chaining.
        const addStep = page.locator('button', { hasText: /add step/i }).first();
        if (await addStep.count()) {
            await addStep.click();
            await page.waitForTimeout(700);
            const selects = page.locator('select[id^="image-select-"]');
            if ((await selects.count()) > 1) {
                await selects.nth(1).selectOption('rocker/r-ver');
                await page.waitForTimeout(400);
                await page.locator('select[id^="tag-select-"]').nth(1).selectOption('4.5.2');
                await page.locator('input[id^="execution-file-"]').nth(1).fill('main.R');
            }
            await page.waitForTimeout(500);
            await shotOf(page, '.config-section, form, .runner-card', 'sivacor-image-choice-chained-2.png');
            // Drop back to a single step so the run stays quick.
            const remove = page.locator('button.remove-config-btn').last();
            if (await remove.count()) {
                await remove.click();
                await page.waitForTimeout(600);
            }
        }

        await shotOf(page, 'button.run-button', 'sivacor-image-run-chained.png');

        // Not submitJob(): it always re-uploads, and #file-input is gone once an
        // upload has succeeded. The form is already filled in above.
        const responded = page.waitForResponse(
            (r) => r.url().includes('/sivacor/submit_job') && r.request().method() === 'POST',
            { timeout: 120000 }
        );
        await page.click('button.run-button');
        const res = await responded;
        console.log(`  · submit_job → ${res.status()}`);
        await page.waitForFunction(() => /Job ID/i.test(document.body.innerText), null, { timeout: 120000 });
        // Running, with live logs open.
        await page.waitForTimeout(6000);
        const logsToggle = page.locator('button, summary', { hasText: /live container logs/i }).first();
        if (await logsToggle.count()) {
            await logsToggle.click().catch(() => {});
            await page.waitForTimeout(2500);
        }
        await shot(page, 'sivacor-running-job.png');

        await waitTerminal(page, 600000);
        await page.waitForTimeout(2500);
        await shot(page, 'sivacor-running-job-success.png');
        await shotOf(page, '.files-section', 'sivacor-screenshot.png');
        await shotOf(page, '.result-section.success', 'sivacor-completed-delete.png');
    } finally {
        await close();
    }
}

// ------------------------------------------------- the Advanced panel (#43)
/**
 * The Advanced panel, opened, showing the real machine-size ladder.
 *
 * Its own phase rather than a shot inside `run`, for two reasons that both make
 * an in-phase shot quietly wrong:
 *
 *  - deploy-dev seeds no size catalogue, so the picker falls through to the
 *    plugin's single 60 GiB default and the shot shows one rung where production
 *    has four. This phase installs the production ladder and restores it.
 *  - `run` drives the deploy-dev **admin**, who bypasses the group gate by
 *    design, so the two "by request" rungs would render selectable. This phase
 *    drives a member, which is what the docs describe.
 */
const LADDER = [
    { memory_gb: 30, flavor: 'm3.medium', vcpus: 8, gated: false },
    { memory_gb: 60, flavor: 'm3.large', vcpus: 16, gated: false },
    { memory_gb: 125, flavor: 'm3.xl', vcpus: 32, gated: true },
    { memory_gb: 250, flavor: 'm3.2xl', vcpus: 64, gated: true },
];

async function phaseAdvanced() {
    console.log('\n[advanced] seeding the production size ladder, shooting as a member');
    const token = await girderToken();
    const original = await fetch(`${API}/system/setting?key=sivacor.worker_sizes`, {
        headers: { 'Girder-Token': token },
    }).then((r) => r.json());
    await setSetting('sivacor.worker_sizes', LADDER, token);
    const { page, close } = await open({ headless: true, token: await getMemberToken(token) });
    try {
        await page.setViewportSize(VIEWPORT);
        await resetToRunner(page, { advanced: false });
        await dismissCookies(page);
        await page.waitForTimeout(600);
        // The smallest rung, which is what a new submission gets: the picker
        // remembers the last choice in localStorage, and a shot showing a
        // larger one would contradict the docs.
        await openAdvanced(page);
        const picker = page.locator('#worker-size-select');
        if (await picker.count()) {
            const smallest = await picker
                .locator('option')
                // The `value` *property*, not the attribute: Svelte binds a
                // numeric option value through its own value map and never
                // writes the attribute, so getAttribute('value') is null.
                .evaluateAll((els) => els.find((e) => !e.disabled)?.value ?? null);
            if (smallest) await picker.selectOption(smallest);
            await page.waitForTimeout(700);
        }
        await shotOf(page, 'details.advanced-section', 'sivacor-advanced-panel.png');
    } finally {
        await setSetting('sivacor.worker_sizes', original, token).catch(() => {});
        console.log('  · restored sivacor.worker_sizes');
        await close();
    }
}

// ------------------------------------------------------------- failed run
async function phaseFailed() {
    console.log('\n[failed] submitting a package that errors');
    const { page, close } = await open({ headless: true });
    try {
        await page.setViewportSize(VIEWPORT);
        // { advanced: false }: the shots have to show the form as a user
        // first meets it, and since #43 that is with Advanced folded.
        await resetToRunner(page, { advanced: false });
        await dismissCookies(page);
        const { status, id } = await submitJob(page, { zip: makeFailingPackage(), mainFile: 'main.R' });
        console.log(`  · submit_job → ${status} ${id ?? ''}`);
        await waitTerminal(page, 600000);
        await page.waitForTimeout(2500);
        await shot(page, 'sivacor-failed.png');
    } finally {
        await close();
    }
}

// -------------------------------------------------- waiting for a worker
async function phaseWaiting() {
    console.log('\n[waiting] scaling wt_local_worker to 0 to reproduce the queued state');
    let scaledDown = false;
    const { page, close } = await open({ headless: true });
    try {
        await page.setViewportSize(VIEWPORT);
        swarm(['service', 'scale', '--detach', 'wt_local_worker=0']);
        scaledDown = true;
        await sleep(8000);

        // { advanced: false }: the shots have to show the form as a user
        // first meets it, and since #43 that is with Advanced folded.
        await resetToRunner(page, { advanced: false });
        await dismissCookies(page);
        const { status, id } = await submitJob(page, { skipForm: false });
        console.log(`  · submit_job → ${status} ${id ?? ''}`);
        // The folder is created by the worker, so with none running the UI
        // should settle on the waiting card.
        await page.waitForFunction(() => /waiting for a worker/i.test(document.body.innerText), null, {
            timeout: 90000,
        });
        await page.waitForTimeout(1200);
        await shot(page, 'sivacor-waiting-for-worker.png');
    } catch (e) {
        console.log('  ! waiting phase failed:', e.message.slice(0, 200));
    } finally {
        if (scaledDown) {
            swarm(['service', 'scale', '--detach', 'wt_local_worker=1']);
            console.log('  · restored wt_local_worker=1');
        }
        await close();
    }
}

const RUN = {
    login: phaseLogin,
    run: phaseRun,
    advanced: phaseAdvanced,
    failed: phaseFailed,
    waiting: phaseWaiting,
};
for (const name of ['login', 'run', 'advanced', 'failed', 'waiting']) {
    if (want(name)) await RUN[name]();
}
console.log(`\nWrote ${shots.length} screenshot(s) to ${OUT}`);
shots.forEach((s) => console.log(`  ${s}`));
