// Scenario: JobRunner form -- the workflow-import panel (#37) and the drop-zone
// hit areas it shares the page with.
//
//   node e2e/runner.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import { open, resetToRunner, sleep } from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const wf = path.join(os.tmpdir(), 'sivacor-e2e-workflow.yaml');
fs.writeFileSync(
    wf,
    `stages:
  - image_name: rocker/r-ver
    image_tag: "4.6.1"
    main_file: main.R
    network_isolation: true
  - image_name: rocker/r-ver
    image_tag: "4.5.2"
    main_file: second.R
env_secrets:
  - key: API_TOKEN
    value: s3cret
`
);

const { page, close } = await open();
await resetToRunner(page);
await sleep(1000);

const panel = page.locator('details.import-section');
const summary = page.locator('summary.import-header');
const isOpen = async () => (await panel.getAttribute('open')) !== null;

// -- #37: optional means collapsed ----------------------------------------
check('import panel is collapsed by default', !(await isOpen()));
check('workflow file input is not reachable while collapsed',
    !(await page.locator('#workflow-import-input').isVisible().catch(() => false)));
const collapsedText = await page.evaluate(() => document.body.innerText);
check('header reads as optional',
    /Optional: Import workflow definition/.test(collapsedText) &&
    /Configure multiple steps based on a file/.test(collapsedText));

// -- no invisible file input is covering the header ------------------------
// FileUploader's archive input is absolutely positioned; without top/left it
// hangs a full drop-zone height past its widget and eats these clicks.
const overlap = await page.evaluate(() => {
    const a = document.querySelector('#file-input')?.getBoundingClientRect();
    const b = document.querySelector('summary.import-header')?.getBoundingClientRect();
    if (!a || !b) return null;
    const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    return dy > 0 && dx > 0 ? Math.round(dy * dx) : 0;
});
check('archive file input does not overlap the import header', overlap === 0, `${overlap}px^2`);

// -- clicking the text (not a button) unfolds, per the issue ---------------
await page.locator('span.import-title').click();
await sleep(500);
check('clicking the header text unfolds the panel', await isOpen());
check('drop zone visible once unfolded', await page.locator('#workflow-import-input').isVisible());

await summary.focus();
await page.keyboard.press('Enter');
await sleep(300);
check('keyboard toggles the disclosure', !(await isOpen()));
await page.keyboard.press('Enter');
await sleep(300);

// -- importing still works -------------------------------------------------
await page.setInputFiles('#workflow-import-input', wf);
await page.waitForFunction(() => /Imported \d+ steps?/.test(document.body.innerText), null, {
    timeout: 60000,
});
const rows = await page.locator('.config-row').count();
check('import populates every stage', rows === 2, `${rows} step rows`);
const mainFiles = await page
    .locator('input[id^="execution-file-"]')
    .evaluateAll((els) => els.map((e) => e.value));
check('stages keep their order', JSON.stringify(mainFiles) === JSON.stringify(['main.R', 'second.R']),
    JSON.stringify(mainFiles));
check('panel stays open to show the result', await isOpen());

// Collapsing is a display concern; it must not touch the imported form.
await page.locator('span.import-title').click();
await sleep(400);
check('collapsing does not discard the import', (await page.locator('.config-row').count()) === 2);

await close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
