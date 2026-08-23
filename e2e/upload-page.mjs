// Scenario: issue #43 -- the three upload-page cleanups.
//
//   1. Worker size, scratch disk and secrets fold under "Advanced", shut by
//      default, with a digest so folding is not hiding.
//   2. "Run Replication Workflow" is grey while there is no file and while one
//      is still uploading, and goes back to grey when the file is deleted.
//   3. The terminal states offer one button, not "Run New Job" beside
//      "Delete & Run New Job".
//
//   node e2e/upload-page.mjs
//
// Item 2 is the one that needs a real browser. The bug it covers is a *timing*
// state -- live button during a multi-minute upload -- which no static
// assertion after the upload can see, so the check below samples while the
// chunks are still going up. It needs a package big enough to take more than one
// 5 MB chunk; the shared fixture is a few hundred bytes and uploads inside a
// single tick, which is precisely how this went unnoticed.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
    makePackage,
    open,
    openAdvanced,
    resetToRunner,
    sleep,
    submitJob,
    waitTerminal,
} from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

/**
 * A package that takes long enough to upload to be observed mid-flight.
 *
 * Incompressible bytes on purpose, stored with `zip -0`: anything compressible
 * would squash back under one 5 MB chunk and the upload would again finish
 * inside a single tick, which is exactly how this went unnoticed.
 */
function makeBigPackage(mb = 60) {
    const dir = path.join(os.tmpdir(), 'sivacor-e2e-big');
    const zip = path.join(dir, 'package.zip');
    if (fs.existsSync(zip)) return zip;
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(
        new URL('./fixtures/main.R', import.meta.url).pathname,
        path.join(dir, 'main.R')
    );
    const blob = path.join(dir, 'filler.bin');
    fs.writeFileSync(blob, Buffer.alloc(0));
    // randomBytes caps at 65536 per call, so fill in 64 KiB strides.
    for (let i = 0; i < mb * 16; i++) fs.appendFileSync(blob, randomBytes(65536));
    execFileSync('zip', ['-qj', '-0', zip, path.join(dir, 'main.R'), blob]);
    return zip;
}

const { page, close } = await open();

try {
    await resetToRunner(page, { advanced: false });
    await sleep(1000);

    // -- item 1: the Advanced fold -----------------------------------------
    const panel = page.locator('details.advanced-section');
    const isOpen = async () => (await panel.getAttribute('open')) !== null;

    check('there is an Advanced panel', (await panel.count()) === 1);
    check('it is folded on a fresh form', !(await isOpen()));

    // The point of folding: these three used to sit between the form and the
    // run button. Not merely "not visible" -- a shut <details> removes them from
    // the layout, which is what brings the button back above the fold.
    for (const [what, sel] of [
        ['the worker-size picker', '#worker-size-select'],
        ['the scratch-disk field', '#scratch-disk-input'],
        ['the secrets panel', '.secrets-section'],
    ]) {
        const present = (await page.locator(sel).count()) > 0;
        const visible = await page.locator(sel).first().isVisible().catch(() => false);
        // The disk field is absent entirely where the deployment offers no
        // volumes, which is deploy-dev's default -- that is not a failure here.
        check(
            `${what} is not on screen while Advanced is shut`,
            !visible,
            present ? 'in the DOM, hidden' : 'not rendered on this deployment'
        );
    }

    const runButtonAbove = await page.evaluate(() => {
        const b = document.querySelector('button.run-button');
        const s = document.querySelector('summary.advanced-summary');
        if (!b || !s) return null;
        return Math.round(b.getBoundingClientRect().top - s.getBoundingClientRect().bottom);
    });
    check(
        'the run button sits just below the fold summary, not three panels down',
        runButtonAbove !== null && runButtonAbove < 140,
        `${runButtonAbove}px between them`
    );

    // Folding must not hide the values: the digest reports them shut.
    const digest = await page.locator('.advanced-digest').innerText();
    check(
        'the summary digests what is inside',
        /GiB/.test(digest) || digest === 'defaults',
        `"${digest}"`
    );

    // Real disclosure semantics, from the element rather than reimplemented.
    await page.locator('summary.advanced-summary').focus();
    await page.keyboard.press('Enter');
    await sleep(300);
    check('the keyboard opens it', await isOpen());
    check('the picker is reachable once open', await page.locator('#worker-size-select').isVisible());
    await page.keyboard.press('Enter');
    await sleep(300);
    check('the keyboard closes it again', !(await isOpen()));

    // A secret typed inside must be counted by the digest, so a folded panel
    // never conceals something that will be sent with the submission.
    await openAdvanced(page);
    await page.locator('button.add-secret-btn').click();
    await sleep(300);
    await page.locator('input.secret-key-input').first().fill('API_TOKEN');
    await page.keyboard.press('Tab');
    await sleep(400);
    await page.locator('summary.advanced-summary').click();
    await sleep(400);
    const withSecret = await page.locator('.advanced-digest').innerText();
    check('the digest counts a secret held inside the folded panel',
        /1 secret\b/.test(withSecret), `"${withSecret}"`);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(2500);
    await resetToRunner(page, { advanced: false });
    await sleep(800);

    // -- item 2: the run button is grey with no file -----------------------
    const runButton = page.locator('button.run-button');
    check('the run button is grey on an empty form', await runButton.isDisabled());
    const hintEmpty = await page.locator('.run-blocked-hint').innerText().catch(() => '');
    check('and says why, rather than being a dead control',
        /upload a file/i.test(hintEmpty), `"${hintEmpty}"`);

    // -- item 2: grey *while uploading* ------------------------------------
    // The original report: "while the file was still uploading, the run
    // replication was green". Sampled during the upload, because after it there
    // is nothing left to see.
    const big = makeBigPackage();
    const bytes = fs.statSync(big).size;
    console.log(`   upload fixture: ${Math.round(bytes / 1024 / 1024)} MB`);
    await page.setInputFiles('#file-input', big);
    await sleep(300);
    await page.locator('button.upload-button').click();

    const samples = [];
    for (let i = 0; i < 60; i++) {
        const done = await page
            .evaluate(() => /Upload Successful/i.test(document.body.innerText))
            .catch(() => false);
        if (done) break;
        const inFlight = await page
            .evaluate(() => /Uploading|Initiating upload/i.test(document.body.innerText))
            .catch(() => false);
        if (inFlight) {
            samples.push({
                disabled: await runButton.isDisabled().catch(() => null),
                hint: await page.locator('.run-blocked-hint').innerText().catch(() => ''),
            });
        }
        await sleep(250);
    }
    check('the upload was actually observed in flight', samples.length > 0,
        `${samples.length} samples`);
    const live = samples.filter((s) => s.disabled === false).length;
    check('the run button is grey for every sample taken during the upload',
        samples.length > 0 && live === 0,
        `${live} of ${samples.length} samples had it live`);
    check('the hint names uploading, not a missing file',
        samples.some((s) => /finish uploading/i.test(s.hint)),
        JSON.stringify(samples[0]?.hint ?? null));

    await page.waitForFunction(() => /Upload Successful/i.test(document.body.innerText), null, {
        timeout: 300000,
    });
    await sleep(500);
    check('the run button goes live once the upload finishes',
        !(await runButton.isDisabled()));
    check('and the hint is gone', (await page.locator('.run-blocked-hint').count()) === 0);

    // -- item 2: greys out again when the file is deleted ------------------
    // The literal question in the issue: "shouldn't that revert to greyed out
    // once the file is deleted?"
    const deleteUpload = page
        .locator('.upload-success button', { hasText: /delete|remove/i })
        .first();
    const hasDelete = (await deleteUpload.count()) > 0;
    check('the uploaded file can be deleted from the form', hasDelete);
    if (hasDelete) {
        await deleteUpload.click();
        await sleep(2500);
        check('deleting the file greys the run button again',
            await runButton.isDisabled());
        const hintAfter = await page.locator('.run-blocked-hint').innerText().catch(() => '');
        check('and it asks for a file again',
            /upload a file/i.test(hintAfter), `"${hintAfter}"`);
    }

    // -- item 3: one button in the terminal state --------------------------
    // A real submission, run to a terminal state, because the button row only
    // exists there.
    const sub = await submitJob(page, { zip: makePackage(), mainFile: 'main.R' });
    check('submission accepted', sub.status === 200 && sub.id !== null,
        `${sub.status} ${sub.id ?? ''}`);
    const status = await waitTerminal(page);
    console.log(`   job reached ${status}`);

    const row = page.locator('.action-buttons-row');
    check('a terminal state shows an action row', (await row.count()) === 1, `${await row.count()}`);
    const buttons = await row.locator('button').evaluateAll((els) =>
        els.map((e) => e.innerText.replace(/\s+/g, ' ').trim())
    );
    check('it offers exactly one button', buttons.length === 1, JSON.stringify(buttons));
    check('the plain "Run New Job" twin is gone',
        (await page.locator('button.new-job-button').count()) === 0);
    check('the one button says it deletes',
        buttons.length === 1 && /delete/i.test(buttons[0]), JSON.stringify(buttons));

    // And it has to actually work as the only way off the monitor -- the
    // confirm() is accepted by open()'s dialog handler.
    const back = await resetToRunner(page, { advanced: false });
    check('the single button really returns to the form', back);
} finally {
    await close();
}

const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) {
    console.log('failed: ' + failed.map((c) => c.name).join('; '));
    process.exit(1);
}
