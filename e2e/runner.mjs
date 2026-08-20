// Scenario: JobRunner form -- the workflow-import panel (#37), the worker-size
// picker (P4.2) and the drop-zone hit areas they share the page with.
//
//   node e2e/runner.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    apiGet,
    getMemberToken,
    getToken,
    open,
    resetToRunner,
    setSetting,
    sleep,
    UI,
} from './lib.mjs';

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

// A real ladder, installed before the page loads because the picker reads the
// catalogue once on mount. deploy-dev seeds none, so it would otherwise fall
// through to the plugin's single-rung default -- and one option cannot test
// picking. Restored at the end; a crash before then leaves the ladder in place,
// which is harmless on a stack that never boots a VM.
const LADDER = [
    { memory_gb: 30, flavor: 'm3.medium', vcpus: 8, gated: false },
    { memory_gb: 60, flavor: 'm3.large', vcpus: 16, gated: false },
    { memory_gb: 250, flavor: 'm3.2xl', vcpus: 64, gated: true },
];
const setupToken = await getToken();
const originalSizes = await apiGet('/system/setting?key=sivacor.worker_sizes', setupToken);
await setSetting(setupToken, 'sivacor.worker_sizes', LADDER);

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

// -- the "Expected format" example must itself be importable ---------------
// It lives in a template literal, so its indentation is rendered output rather
// than source layout -- a reformat of the surrounding markup can silently shift
// env_secrets into looking like a member of stages. Feeding the displayed text
// straight back through the importer is the only check that notices.
await page.locator('details.import-example summary').click();
await sleep(300);
const example = await page.locator('details.import-example pre').innerText();
console.log('--- rendered example ---\n' + example + '\n------------------------');
const topLevelKeys = example
    .split('\n')
    .filter((l) => /^\S/.test(l))
    .map((l) => l.split(':')[0]);
check('stages, env_secrets and resources are top-level peers',
    topLevelKeys.includes('stages') &&
    topLevelKeys.includes('env_secrets') &&
    topLevelKeys.includes('resources'),
    JSON.stringify(topLevelKeys));

const examplePath = path.join(os.tmpdir(), 'sivacor-e2e-example.yaml');
fs.writeFileSync(examplePath, example.endsWith('\n') ? example : `${example}\n`);
await page.setInputFiles('#workflow-import-input', examplePath);
await page.waitForFunction(
    () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
    null,
    { timeout: 60000 }
);
const exampleResult = await page.evaluate(() => document.body.innerText);
check('the example we show actually imports', /Imported \d+ steps? and 1 secret/.test(exampleResult),
    (exampleResult.match(/Imported[^\n]*|could not be imported[\s\S]{0,200}/) || ['?'])[0].slice(0, 170));

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

// -- environment secrets -----------------------------------------------------
// The rows are keyed by the variable name, so committing a name re-keys the row
// and rebuilds it. Everything downstream of that rebuild has to survive.
// Reload first: the import above left a secret behind, and secrets are held in
// component memory only, so a fresh page is the cheapest way back to zero rows.
await page.goto(`${UI}/`, { waitUntil: 'networkidle', timeout: 120000 });
await resetToRunner(page);
await sleep(800);
check('secrets start empty on a fresh form',
    (await page.locator('input.secret-key-input').count()) === 0);

await page.locator('button.add-secret-btn').click();
await sleep(300);
await page.locator('input.secret-key-input').first().click();
await page.keyboard.type('API_TOKEN', { delay: 30 });
const typedName = await page.locator('input.secret-key-input').first().inputValue();
check('a secret name can be typed without losing focus', typedName === 'API_TOKEN', typedName);

await page.keyboard.press('Tab'); // commit: re-keys the row
await sleep(300);
await page.locator('input.secret-value-input').first().fill('s3cret');
await page.keyboard.press('Tab');
await sleep(300);

await page.locator('button.add-secret-btn').click();
await sleep(300);
await page.locator('input.secret-key-input').nth(1).click();
await page.keyboard.type('SECOND_VAR', { delay: 30 });
await page.keyboard.press('Tab');
await sleep(300);
await page.locator('input.secret-value-input').nth(1).fill('second-value');
await page.keyboard.press('Tab');
await sleep(400);

const names = await page
    .locator('input.secret-key-input')
    .evaluateAll((els) => els.map((e) => e.value));
const vals = await page
    .locator('input.secret-value-input')
    .evaluateAll((els) => els.map((e) => e.value));
check('secret names survive the re-key',
    JSON.stringify(names) === JSON.stringify(['API_TOKEN', 'SECOND_VAR']), JSON.stringify(names));
check('values stay attached to their own row',
    JSON.stringify(vals) === JSON.stringify(['s3cret', 'second-value']), JSON.stringify(vals));

// Exact class: the restored step rows have remove buttons too, and a loose
// aria-label match hits those first.
await page.locator('button.remove-secret-btn').first().click();
await sleep(400);
const remaining = await page
    .locator('input.secret-key-input')
    .evaluateAll((els) => els.map((e) => e.value));
check('removing a secret drops the right row',
    JSON.stringify(remaining) === JSON.stringify(['SECOND_VAR']), JSON.stringify(remaining));

// -- P4.2: the worker-size picker -----------------------------------------
const picker = page.locator('#worker-size-select');
check('the picker is on the form', (await picker.count()) === 1);
// The form is holding two imported steps at this point, so "one" is the whole
// claim: a per-stage control would give one per row and promise a size per step
// that the platform cannot deliver.
check('one picker for the whole submission, not one per step',
    (await page.locator('.config-row').count()) === 2 && (await picker.count()) === 1,
    `${await page.locator('.config-row').count()} steps`);

const options = await picker.locator('option').evaluateAll((els) =>
    els.map((e) => ({ value: e.value, label: e.textContent.trim(), disabled: e.disabled }))
);
console.log('--- picker options ---\n' + options.map((o) => JSON.stringify(o)).join('\n'));
const laddered = options.map((o) => Number(o.value)).join() === '30,60,250';
check('every rung is offered', laddered, options.map((o) => o.value).join());
// Not anchored: the wording around the figures is copy and may be tuned. The
// figures themselves are the contract -- the number *is* the size class, and
// the usable figure must keep its `≈` because it ignores the kernel reserve.
check('labels carry the real numbers, not a size class',
    /30 GiB · 8 cores — ≈28 GiB usable/.test(options[0]?.label ?? ''), options[0]?.label);
// This page is the deploy-dev *admin*, who bypasses the gate by design, so
// every rung is choosable here and nothing reads as "by request". The closed
// side is asserted further down, as a user who is not an admin -- an admin
// cannot see any rule an admin is exempt from.
// Guarded, so a catalogue that did not install reads as one failure rather than
// a TypeError that buries every check after it.
check('an admin may pick a gated rung',
    laddered && !options[2].disabled && !/by request/.test(options[2].label),
    options[2]?.label ?? 'no third rung');
check('ungated rungs are choosable',
    laddered && !options[0].disabled && !options[1].disabled);
check('defaults to the smallest', (await picker.inputValue()) === '30', await picker.inputValue());

const hint = await page.locator('#worker-size-hint').innerText();
check('the hint says disk does not grow with the rung', /60 GB of disk/.test(hint), hint);
check('the hint gives the cost ratio', /8×/.test(hint), hint);
check('nothing is "by request" for someone who bypasses the gate',
    !/support@sivacor\.org/.test(hint), hint);

// Persistence: the choice is remembered like the image/tag selections are.
await picker.selectOption('60');
await sleep(400);
await page.reload({ waitUntil: 'networkidle' });
await sleep(2500);
check('the chosen size survives a reload',
    (await page.locator('#worker-size-select').inputValue()) === '60',
    await page.locator('#worker-size-select').inputValue());

// -- an imported workflow drives the picker -------------------------------
await page.locator('span.import-title').click();
await sleep(400);
const sized = path.join(os.tmpdir(), 'sivacor-e2e-sized.yaml');
const writeWorkflow = (memory) => {
    fs.writeFileSync(
        sized,
        `resources:
  memory_gb: ${memory}
stages:
  - image_name: rocker/r-ver
    image_tag: "4.6.1"
    main_file: main.R
`
    );
    return sized;
};
const importAndRead = async (file) => {
    await page.setInputFiles('#workflow-import-input', file);
    await page.waitForFunction(
        () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
        null,
        { timeout: 60000 }
    );
    return page.evaluate(() => document.body.innerText);
};

await importAndRead(writeWorkflow(30));
check('an imported workflow sets the size',
    (await page.locator('#worker-size-select').inputValue()) === '30',
    await page.locator('#worker-size-select').inputValue());

// A size that is not in the catalogue at all is refused by submit_job, so the
// importer has to refuse it while the file is still in front of the user -- and
// name what may be asked for instead, because the file carries a bare number
// and a rung can be withdrawn.
const before = await page.locator('#worker-size-select').inputValue();
const unknownResult = await importAndRead(writeWorkflow(125));
check('an unknown size is refused, naming the offered ones',
    /could not be imported/.test(unknownResult) && /no 125 GB worker size is offered/.test(unknownResult),
    (unknownResult.match(/resources:[^\n]*/) || ['?'])[0].slice(0, 160));
check('a refused import does not move the picker',
    (await page.locator('#worker-size-select').inputValue()) === before,
    `${before} -> ${await page.locator('#worker-size-select').inputValue()}`);

await close();

// -- S5 guard 2, from the other side of the gate ---------------------------
// Everything above ran as the admin, who is exempt. What a researcher sees is
// only visible to a non-admin, so this section drives one.
const memberToken = await getMemberToken(setupToken);
const asMember = await open({ token: memberToken });
await resetToRunner(asMember.page);
await sleep(1500);

const memberOptions = await asMember.page
    .locator('#worker-size-select option')
    .evaluateAll((els) =>
        els.map((e) => ({ value: e.value, label: e.textContent.trim(), disabled: e.disabled }))
    );
console.log('--- picker options (non-admin) ---\n' +
    memberOptions.map((o) => JSON.stringify(o)).join('\n'));
const memberLaddered = memberOptions.map((o) => Number(o.value)).join() === '30,60,250';
check('a non-admin is offered the gated rung too, disabled',
    memberLaddered && memberOptions[2].disabled && /by request/.test(memberOptions[2].label),
    memberOptions[2]?.label ?? 'no third rung');
check('a non-admin can still choose the ungated rungs',
    memberLaddered && !memberOptions[0].disabled && !memberOptions[1].disabled);

const memberHint = await asMember.page.locator('#worker-size-hint').innerText();
check('the hint names the request route when something is gated',
    /support@sivacor\.org/.test(memberHint), memberHint);

await asMember.page.locator('span.import-title').click();
await sleep(400);
const memberBefore = await asMember.page.locator('#worker-size-select').inputValue();
await asMember.page.setInputFiles('#workflow-import-input', writeWorkflow(250));
await asMember.page.waitForFunction(
    () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
    null,
    { timeout: 60000 }
);
const gatedResult = await asMember.page.evaluate(() => document.body.innerText);
check('a gated size is refused on import',
    /could not be imported/.test(gatedResult) && /support@sivacor\.org/.test(gatedResult),
    (gatedResult.match(/resources:[^\n]*/) || ['?'])[0].slice(0, 170));
check('the gated refusal names the sizes that are available',
    /30 GB/.test(gatedResult) && /60 GB/.test(gatedResult),
    (gatedResult.match(/resources:[^\n]*/) || ['?'])[0].slice(0, 170));
check('the refused gated import does not move the picker',
    (await asMember.page.locator('#worker-size-select').inputValue()) === memberBefore,
    `${memberBefore} -> ${await asMember.page.locator('#worker-size-select').inputValue()}`);

await asMember.close();
await setSetting(setupToken, 'sivacor.worker_sizes', originalSizes);
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
