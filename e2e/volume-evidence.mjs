// Scenario: C4's two halves that need a *finished* run -- the peak-workspace
// hint, and `disk_gb` surviving the export/re-import round trip.
//
//   node e2e/volume-evidence.mjs
//
// Split from volume-disk.mjs because the precondition is different and awkward:
// **on a stack with no fleet controller, a submission that asks for disk can
// never finish.** Asking requires `sivacor.targeted_assignment`, and under that
// flag submit_job records the chain for a controller to publish instead of
// publishing it -- so the job sits RUNNING forever and there is nothing to
// export from and no performance data to quote. volume-disk.mjs asserts the
// *request* end (payload, refusals, what the job records); this file asserts the
// *evidence* end, and gets its precondition the only way available locally:
//
//   - The peak-workspace hint needs no faking at all. `MaxDiskUsage` is written
//     by recorded_run's poll loop on every run, volume or not, so an ordinary
//     submission produces the real number the hint quotes.
//   - The export needs `meta.requested_disk_gb` on the submission folder, which
//     only a granted volume produces. So it is **written onto a genuinely
//     finished run** with the admin metadata route, and removed afterwards.
//
// **What that means this file does NOT show:** that the worker records the field
// itself. Nothing here exercises prepare_submission. volume-disk.mjs covers the
// server side (`meta.requested_disk_gb` on the *job*), and the folder leg is
// only observable against a real fleet -- which is exactly the gap C3's write-up
// already records for the same reason.

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    API,
    apiGet,
    getMemberToken,
    getToken,
    open,
    resetToRunner,
    setSetting,
    sleep,
    submitJob,
    waitTerminal,
} from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

/** The ceiling granted for this run: 100, so `max` and the 95->100 edge are real. */
const CEILING_GB = 100;
const DEPLOYMENT_GB = 200;
/** What the exported submission will claim to have been granted. */
const GRANTED_GB = 20;

const adminToken = await getToken();
const memberToken = await getMemberToken(adminToken);
const member = await apiGet('/user/me', memberToken);

async function setQuota(gb) {
    const r = await fetch(`${API}/sivacor/user/${member._id}/volume_quota?maxGb=${gb}`, {
        method: 'PUT',
        headers: { 'Girder-Token': adminToken },
    });
    if (!r.ok) throw new Error(`PUT volume_quota -> ${r.status} ${await r.text()}`);
    const seen = await apiGet('/sivacor/volume_quota', memberToken);
    if (seen.max_gb !== gb) throw new Error(`quota did not take: ${JSON.stringify(seen)}`);
}

/** The submission folder for a job, the same two hops the app makes. */
async function submissionFolder(jobId) {
    const collections = await apiGet('/collection?name=Submissions', adminToken);
    if (!collections?.length) return null;
    const folders = await apiGet(
        `/folder?parentType=collection&parentId=${collections[0]._id}&jobId=${jobId}`,
        adminToken
    );
    return folders?.[0] ?? null;
}

/**
 * Write (or, with null, delete) one metadata key on a submission folder.
 *
 * Girder's metadata PUT treats a null as a *delete*, which is why the cleanup
 * below passes null rather than 0 -- and why an exported workflow for a
 * submission with no volume carries no `disk_gb` line at all rather than an
 * explicit null the importer would have to interpret (C1 as built, finding 1).
 */
async function setFolderMeta(folderId, key, value) {
    // No `allowNull=true`: that parameter makes Girder *store* the null, which is
    // the opposite of what the cleanup needs. The default is the delete-on-null
    // behaviour C1 documented, and this function relies on it.
    const r = await fetch(`${API}/folder/${folderId}/metadata`, {
        method: 'PUT',
        headers: { 'Girder-Token': adminToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value }),
    });
    if (!r.ok) throw new Error(`PUT folder metadata -> ${r.status} ${await r.text()}`);
    return (await r.json())?.meta ?? {};
}

/** MaxDiskUsage for a stage, read the way the monitor reads it. */
async function stagePeakDisk(folderId, stageNumber = 1) {
    const items = await apiGet(
        `/item?folderId=${folderId}&name=${encodeURIComponent(`performance_data_stage_${stageNumber}.json`)}`,
        adminToken
    );
    if (!items?.length) return null;
    const r = await fetch(`${API}/item/${items[0]._id}/download`, {
        headers: { 'Girder-Token': adminToken },
    });
    if (!r.ok) return null;
    return (await r.json())?.MaxDiskUsage ?? null;
}

/** JobRunner's formatBytes, so the assertion compares what the user sees. */
function formatBytes(bytes) {
    if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return 'N/A';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

const originals = {
    volumes_enabled: await apiGet('/system/setting?key=sivacor.volumes_enabled', adminToken),
    volume_total_gb: await apiGet('/system/setting?key=sivacor.volume_total_gb', adminToken),
};
let patchedFolderId = null;

try {
    // Targeted assignment is deliberately left alone: this scenario never asks
    // for a volume, so it does not need arming -- and arming it would stop the
    // run it depends on from ever being published.
    await setSetting(adminToken, 'sivacor.volumes_enabled', true);
    await setSetting(adminToken, 'sivacor.volume_total_gb', DEPLOYMENT_GB);
    await setQuota(CEILING_GB);

    const { page, close } = await open({ token: memberToken });
    await resetToRunner(page);
    await sleep(1500);

    // -- 1 and 2, at the numbers the production account actually has ----------
    const field = page.locator('#scratch-disk-input');
    check('the field is bounded by a 100 GB ceiling',
        (await field.getAttribute('max')) === String(CEILING_GB),
        await field.getAttribute('max'));
    await field.fill('95');
    await sleep(400);
    let body = await page.evaluate(() => document.body.innerText);
    // The edge worth having: 95 rounds *past* nothing -- 100 is exactly the
    // ceiling, so it must round up and still be accepted. One GB more and the
    // rounded figure clears the ceiling, which is C1's check-then-round bug.
    check('95 rounds up to exactly the ceiling, and is not refused',
        /Rounds up to\s*100 GB/.test(body) && !/more than your/.test(body),
        (body.match(/Rounds up to[^\n]*|more than your[^\n]*/) || ['?'])[0]);
    await field.fill('101');
    await sleep(400);
    body = await page.evaluate(() => document.body.innerText);
    check('101 is refused, because 110 would exceed the ceiling',
        /more than your 100 GB limit/.test(body),
        (body.match(/more than your[^\n]*/) || ['?'])[0]);
    await field.fill('');
    await sleep(300);

    // -- the run everything below needs --------------------------------------
    // No disk requested: see the header. What it produces is a real
    // MaxDiskUsage and a real submission folder.
    const submitted = await submitJob(page, { mainFile: 'main.R' });
    check('a plain submission still runs with volumes enabled', submitted.status === 200,
        `${submitted.status} ${submitted.id ?? ''}`);
    const status = await waitTerminal(page);
    check('it reaches a terminal state', ['SUCCESS', 'ERROR'].includes(status), status);

    const folder = await submissionFolder(submitted.id);
    check('the submission folder exists', Boolean(folder), folder?._id);
    const peakDisk = await stagePeakDisk(folder._id);
    check('the run recorded a peak workspace', typeof peakDisk === 'number',
        `MaxDiskUsage=${peakDisk}`);

    // -- 5: the export round trip, on a submission that "was granted" 20 GB ---
    patchedFolderId = folder._id;
    const meta = await setFolderMeta(folder._id, 'requested_disk_gb', GRANTED_GB);
    check('the folder now carries a granted size to export',
        meta.requested_disk_gb === GRANTED_GB, JSON.stringify(meta.requested_disk_gb));

    await page.goto(`${page.url().split('?')[0]}?jobId=${submitted.id}`, {
        waitUntil: 'networkidle',
    });
    await sleep(3000);
    const card = page.locator('.file-card', { hasText: 'Workflow definition' });
    check('the export is offered for that run', (await card.count()) === 1);

    const download = await Promise.all([
        page.waitForEvent('download', { timeout: 30000 }),
        card.locator('button.download-button').click(),
    ]).then(([d]) => d);
    const out = path.join(os.tmpdir(), 'sivacor-e2e-disk-export.yaml');
    await download.saveAs(out);
    const yaml = fs.readFileSync(out, 'utf8');
    console.log('--- exported file ---\n' + yaml + '---------------------');

    check('the granted disk is exported',
        new RegExp(`^ {2}disk_gb: ${GRANTED_GB}$`, 'm').test(yaml),
        (yaml.match(/^ *disk_gb:.*$/m) || ['no disk_gb'])[0]);
    check('...under a single top-level resources block, beside the size',
        /^resources:$/m.test(yaml) &&
            /^ {2}memory_gb: \d+$/m.test(yaml) &&
            (yaml.match(/^resources:$/gm) || []).length === 1,
        (yaml.match(/^resources:$/gm) || []).length + ' resources blocks');
    // The recipient's allowance is theirs, not the exporter's, and the file has
    // no way to know it -- so it has to say so rather than look like a setting
    // that will simply work.
    check('the exported line warns that importing it needs an allowance',
        /needs your own allowance/.test(yaml),
        (yaml.match(/#.*allowance.*/) || ['no warning'])[0]);

    // -- 6: the peak-workspace hint, against that real number ----------------
    // After the export above, deliberately. Since #43 leaving the monitor is the
    // *delete* path -- there is no longer a "Run New Job" button that keeps the
    // submission -- so this reset destroys `folder`, and anything that needs the
    // folder has to have happened already. The hints survive it because
    // resetJob() snapshots them from the monitor's own metrics before clearing,
    // not from the folder.
    await resetToRunner(page);
    await sleep(1200);
    const diskNote = await page
        .locator('#previous-run-disk')
        .innerText()
        .catch(() => null);
    check('the disk hint quotes the last run', Boolean(diskNote), diskNote);
    check('...with the peak the run actually recorded',
        Boolean(diskNote && diskNote.includes(formatBytes(peakDisk))),
        `hint "${diskNote}" vs MaxDiskUsage ${formatBytes(peakDisk)}`);
    // Both notes at once is the state that broke monitor.mjs's selector, so it
    // is worth asserting deliberately rather than only avoiding.
    const memoryNote = await page
        .locator('#previous-run-memory')
        .innerText()
        .catch(() => null);
    check('the memory hint is still there beside it, and they are distinct',
        Boolean(memoryNote) && memoryNote !== diskNote,
        `${(memoryNote ?? 'null').slice(0, 60)} | ${(diskNote ?? 'null').slice(0, 60)}`);
    check('a small workspace is not nudged towards a volume',
        !/extra scratch disk may help/.test(diskNote ?? ''), diskNote);

    // Round-trip: the same file, back through the importer, must fill the field.
    // The reset above already put the form back.
    await sleep(300);
    await page.locator('span.import-title').click();
    await sleep(500);
    await page.setInputFiles('#workflow-import-input', out);
    await page.waitForFunction(
        () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
        null,
        { timeout: 60000 }
    );
    const result = await page.evaluate(() => document.body.innerText);
    check('the exported file re-imports cleanly', /Imported \d+ steps?/.test(result),
        (result.match(/Imported[^\n]*|could not be imported[\s\S]{0,160}/) || ['?'])[0].slice(0, 160));
    check('the round trip puts the figure back in the field',
        (await page.locator('#scratch-disk-input').inputValue()) === String(GRANTED_GB),
        await page.locator('#scratch-disk-input').inputValue());

    // The other half of the round trip, and the reason the warning above exists:
    // the same file against a smaller allowance has to be refused, naming it.
    await setQuota(10);
    await page.reload({ waitUntil: 'networkidle' });
    await sleep(2500);
    await resetToRunner(page);
    await sleep(1000);
    await page.locator('span.import-title').click();
    await sleep(500);
    await page.setInputFiles('#workflow-import-input', out);
    await page.waitForFunction(
        () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
        null,
        { timeout: 60000 }
    );
    const shrunk = await page.evaluate(() => document.body.innerText);
    check('a workflow exported above the importer\'s ceiling is refused, naming it',
        /could not be imported/.test(shrunk) && /more than your 10 GB limit/.test(shrunk),
        (shrunk.match(/resources:[^\n]*/) || ['?'])[0].slice(0, 160));

    await close();
} finally {
    if (patchedFolderId) {
        // null, not 0: Girder's metadata PUT deletes on null, and 0 would leave
        // a submission claiming it was granted nothing -- which is not the same
        // thing as never having asked.
        //
        // Tolerant of a folder that is already gone: since #43 the reset in the
        // body deletes the submission, so the happy path reaches here with
        // nothing to unpatch. It is kept for the unhappy one -- a crash between
        // the patch and the reset, which does leave test data behind.
        const left = await setFolderMeta(patchedFolderId, 'requested_disk_gb', null).catch(
            (e) => (/Invalid folder id/.test(String(e)) ? null : Promise.reject(e))
        );
        console.log(
            `unpatched folder ${patchedFolderId}:`,
            left === null
                ? 'folder already deleted with the submission'
                : 'requested_disk_gb' in left
                  ? 'STILL SET'
                  : 'removed'
        );
    }
    await setQuota(0);
    for (const [key, value] of Object.entries(originals)) {
        await setSetting(adminToken, `sivacor.${key}`, value);
    }
    console.log('restored: settings and the test account\'s ceiling');
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
