// Scenario: #38 -- export a finished run's workflow definition, and prove the
// exported file round-trips back through the importer.
//
//   node e2e/workflow-export.mjs

import fs from 'fs';
import os from 'os';
import path from 'path';
import { open, submitJob, waitTerminal, resetToRunner, shownJobId, sleep } from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const { page, close } = await open();

// A finished run is the precondition: stages land in the submission folder's
// metadata, which the worker only writes once it has picked the job up.
await resetToRunner(page);
let jobId = await shownJobId(page);
if (!jobId) {
    jobId = (await submitJob(page)).id;
}
const status = await waitTerminal(page);
check('have a finished run to export from', ['SUCCESS', 'ERROR'].includes(status), status);

const card = page.locator('.file-card', { hasText: 'Workflow definition' });
check('export is offered after the run', (await card.count()) === 1);

const dl = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    card.locator('button.download-button').click(),
]).then(([d]) => d);

const out = path.join(os.tmpdir(), 'sivacor-e2e-export.yaml');
await dl.saveAs(out);
const yaml = fs.readFileSync(out, 'utf8');
console.log('--- exported file ---\n' + yaml + '---------------------');

check('filename is derived from the submission', /-workflow\.yaml$/.test(dl.suggestedFilename()),
    dl.suggestedFilename());
check('points at the image_tags endpoint', /sivacor\/image_tags/.test(yaml));
check('names the source submission', yaml.includes(jobId), `job ${jobId}`);
check('documents the secrets placeholder', /env_secrets/.test(yaml) && !/s3cret/.test(yaml));
check('image_tag stays a quoted string', /image_tag: "[^"]+"/.test(yaml),
    (yaml.match(/image_tag:.*/) || [''])[0].trim());

// Round-trip: the exported file must be importable as-is.
await resetToRunner(page);
await page.locator('span.import-title').click();
await sleep(500);
await page.setInputFiles('#workflow-import-input', out);
await page.waitForFunction(
    () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
    null,
    { timeout: 60000 }
);
const result = await page.evaluate(() => document.body.innerText);
check('exported file re-imports cleanly', /Imported \d+ steps?/.test(result),
    (result.match(/Imported[^\n]*|could not be imported[\s\S]{0,200}/) || ['?'])[0].slice(0, 160));

const mainFiles = await page
    .locator('input[id^="execution-file-"]')
    .evaluateAll((els) => els.map((e) => e.value));
check('round-trip preserves the stage', JSON.stringify(mainFiles) === JSON.stringify(['main.R']),
    JSON.stringify(mainFiles));

// -- multi-stage, and a run that failed -----------------------------------
// The point of the feature is handing on a multi-step setup, and a broken one
// is exactly what someone needs help reproducing -- so both must export.
const multi = path.join(os.tmpdir(), 'sivacor-e2e-multi.yaml');
fs.writeFileSync(
    multi,
    `stages:
  - image_name: rocker/r-ver
    image_tag: "4.6.1"
    main_file: main.R
    network_isolation: true
  - image_name: rocker/r-ver
    image_tag: "4.5.2"
    main_file: missing.R
`
);
await page.setInputFiles('#workflow-import-input', multi);
await page.waitForFunction(() => /Imported 2 steps/.test(document.body.innerText), null, {
    timeout: 60000,
});
const sub2 = await submitJob(page, { skipForm: true });
const status2 = await waitTerminal(page);
check('second stage fails as set up', status2 === 'ERROR', status2);

const card2 = page.locator('.file-card', { hasText: 'Workflow definition' });
check('export is offered on a FAILED run too', (await card2.count()) === 1, `job ${sub2.id}`);

const dl2 = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    card2.locator('button.download-button').click(),
]).then(([d]) => d);
const out2 = path.join(os.tmpdir(), 'sivacor-e2e-export-multi.yaml');
await dl2.saveAs(out2);
const yaml2 = fs.readFileSync(out2, 'utf8');
console.log('--- multi-stage export ---\n' + yaml2 + '--------------------------');

const stageCount = (yaml2.match(/- image_name:/g) || []).length;
check('both stages exported', stageCount === 2, `${stageCount} stages`);
check('stage order preserved',
    yaml2.indexOf('"main.R"') < yaml2.indexOf('"missing.R"') && yaml2.includes('"4.5.2"'));
check('per-stage network_isolation preserved',
    /network_isolation: true[\s\S]*network_isolation: false/.test(yaml2),
    (yaml2.match(/network_isolation: \w+/g) || []).join(' , '));

await resetToRunner(page);
await page.locator('span.import-title').click();
await sleep(500);
await page.setInputFiles('#workflow-import-input', out2);
await page.waitForFunction(
    () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
    null,
    { timeout: 60000 }
);
const result2 = await page.evaluate(() => document.body.innerText);
check('multi-stage export re-imports cleanly', /Imported 2 steps/.test(result2),
    (result2.match(/Imported[^\n]*|could not be imported[\s\S]{0,160}/) || ['?'])[0].slice(0, 160));

await close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
