// Scenario: CV6's owed check -- C4's scratch-disk control, on PRODUCTION, as the
// one approved non-admin account.
//
//   SIVACOR_PROD_API_KEY=<api key for the approved account> \
//     node e2e/volume-prod-check.mjs
//
// **READ-ONLY BY CONSTRUCTION, and that is the reason this file exists rather
// than a flag on volume-disk.mjs.** That scenario writes three Girder settings
// (`volumes_enabled`, `volume_total_gb`, `targeted_assignment`), rewrites an
// account's ceiling, and submits jobs -- every one of which is correct against a
// dev stack and catastrophic against a live deployment. So this file imports
// neither `setSetting` nor `submitJob`, touches no quota, and asserts at the end
// that the page issued **no non-GET request at all**. If that assertion ever
// fails, something here started writing and must be reverted, not explained.
//
// **It also refuses to run as an admin, and that is not politeness.** An admin
// has `sivacorMaxVolumeGb = 0` like everybody else -- site admins are
// deliberately NOT exempt from a volume *ceiling*, unlike the worker-size group
// gate they do bypass -- so an admin sees the disabled `(by request)` control
// everyone else sees, every approved-side check fails, and the failure has
// nothing to do with the UI. That mistake has already cost a session twice on
// this feature. Same for an unapproved non-admin: aborted up front with the
// reason, rather than reported as six failures.
//
// Auth is an **API key exchanged for a token** (`POST /api_key/token`), because
// the production accounts sign in through ORCID and OAuth cannot be driven
// headlessly. The key never reaches the command line: it is read from the
// environment.
//
// The six items are the ones written out under CV6 in
// `development_notes/cinder_volumes_rollout.md`. Numbers are derived from the
// live quota rather than hardcoded, so the file keeps working when a ceiling or
// the granularity changes.

import fs from 'fs';
import os from 'os';
import path from 'path';

// Production by default. `lib.mjs` freezes UI/API from this at import time, so
// it has to be set *before* the import -- hence the dynamic import below rather
// than a static one at the top of the file.
process.env.SIVACOR_E2E_DOMAIN ??= 'sivacor.org';
const { API, UI, apiGet, open, reachRunner, sleep } = await import('./lib.mjs');

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};
const note = (msg) => console.log(`      ${msg}`);
const die = (msg) => {
    console.error(`\nABORTED: ${msg}`);
    process.exit(2);
};

const KEY = process.env.SIVACOR_PROD_API_KEY;
if (!KEY) {
    die(
        'SIVACOR_PROD_API_KEY is not set. Create an API key for the approved ' +
            'account (Girder web client -> My account -> API keys) and put it in ' +
            'the environment; it is never passed as an argument.'
    );
}

/** A Girder token from an API key. The only auth path that works unattended. */
async function tokenFromApiKey(key) {
    const r = await fetch(`${API}/api_key/token?key=${encodeURIComponent(key)}`, {
        method: 'POST',
    });
    if (!r.ok) die(`POST /api_key/token -> ${r.status} ${(await r.text()).slice(0, 200)}`);
    const token = (await r.json())?.authToken?.token;
    if (!token) die('no token in the api_key/token response');
    return token;
}

/** JobRunner's formatBytes, so item 6 compares against what the user reads. */
function formatBytes(bytes) {
    if (bytes === undefined || bytes === null || Number.isNaN(bytes)) return 'N/A';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

const workflowFile = (diskGb) => {
    const p = path.join(os.tmpdir(), `sivacor-prod-import-${diskGb}.yaml`);
    fs.writeFileSync(
        p,
        `resources:
  disk_gb: ${diskGb}
stages:
  - image_name: rocker/r-ver
    image_tag: "4.6.1"
    main_file: main.R
`
    );
    return p;
};

const importAndRead = async (page, file) => {
    await page.setInputFiles('#workflow-import-input', file);
    await page.waitForFunction(
        () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
        null,
        { timeout: 60000 }
    );
    return page.evaluate(() => document.body.innerText);
};

// ---------------------------------------------------------------- preconditions

const token = await tokenFromApiKey(KEY);
const me = await apiGet('/user/me', token);
console.log(`\ndriving ${UI} as ${me.login} (admin=${Boolean(me.admin)})`);

if (me.admin) {
    die(
        `${me.login} is a site administrator. An admin sees the disabled ` +
            '"(by request)" control that everyone else sees, because admins are NOT ' +
            'exempt from a volume ceiling -- so every check below would fail for a ' +
            'reason unrelated to the UI. Use the approved non-admin account.'
    );
}

const quota = await apiGet('/sivacor/volume_quota', token);
console.log(`quota for ${me.login}: ${JSON.stringify(quota)}`);
if (!quota.enabled) die('this deployment has volumes disabled -- no control renders at all');
if (!quota.max_gb) {
    die(
        `${me.login} has no volume allowance (max_gb=0), so this account sees the ` +
            'unapproved control. Run as the approved account.'
    );
}

const GRAN = quota.granularity_gb ?? 10;
/** What the form may offer: min(user, deployment), because either can refuse. */
const CEILING = Math.min(quota.max_gb, quota.deployment_gb || quota.max_gb);
/** Between two steps, so the rounding hint has something to say. */
const TYPED = GRAN + Math.floor(GRAN / 2);
const ROUNDED = Math.ceil(TYPED / GRAN) * GRAN;
/** Rounds up to *exactly* the ceiling -- C1's check-then-round bug, at the edge. */
const AT_EDGE = CEILING - Math.floor(GRAN / 2);
const OVER = CEILING + GRAN;
note(`ceiling=${CEILING} GB, granularity=${GRAN} GB, edge=${AT_EDGE}->${CEILING}, over=${OVER}`);

// --------------------------------------------- what production actually serves
// CV6's checks 1-3, repeated here so one command answers "is this the deployed
// bundle, and does the deployment still offer volumes to it". The bundle hash is
// the only identification this check has of the running `wt_submit` image -- the
// digest itself needs `docker service inspect` on the manager.

// **The root HTML does not name the route chunks**, and assuming it did made the
// first production run of this file print "no immutable bundle served (dev
// server?)" about production -- a wrong inference, stated confidently, about the
// one deployment this file exists to check. SvelteKit's shell references only
// `entry/app.*.js` and `entry/start.*.js`; the `nodes/N.*.js` chunk holding the
// form is imported from inside the entry chunk. So follow it one hop.
const html = await (await fetch(`${UI}/`)).text();
const seeds = [...html.matchAll(/_app\/immutable\/[\w./-]+\.js/g)].map((m) => m[0]);
const chunks = new Set(seeds);
for (const seed of seeds) {
    const js = await (await fetch(`${UI}/${seed}`)).text();
    for (const m of js.matchAll(/nodes\/[\w.-]+\.js/g)) {
        chunks.add(`_app/immutable/${m[0]}`);
    }
}
let served = null;
for (const path of chunks) {
    const js = await (await fetch(`${UI}/${path}`)).text();
    if (js.includes('scratch-disk-input')) served = { name: path, js };
}
// A vite dev server serves modules rather than an immutable bundle, so on
// deploy-dev there is nothing to hash-identify. Skipped rather than failed: this
// leg is about what production shipped, and the dry run has no equivalent.
if (!seeds.length) {
    note('no immutable bundle served (dev server) -- bundle identification skipped');
} else {
    check(
        'the deployed bundle carries the disk control',
        Boolean(served),
        `${chunks.size} chunks searched`
    );
}
if (served) {
    // The only identification this check has of the running wt_submit image: the
    // digest needs `docker service inspect` on the manager.
    note(`bundle: ${served.name}`);
    const strings = [
        'scratch-disk-input',
        'Extra Scratch Disk',
        'Rounds up to',
        'previous-run-disk',
        'by request',
    ];
    const missing = strings.filter((s) => !served.js.includes(s));
    check('...and every string C4 shipped', missing.length === 0, missing.join(', ') || 'all present');
}

const anon = await (await fetch(`${API}/sivacor/volume_quota`)).json();
check(
    'an unauthenticated client is offered the deployment reservation and no allowance',
    anon.enabled === true && anon.max_gb === 0 && anon.deployment_gb > 0,
    JSON.stringify(anon)
);

const schema = await (await fetch(`${API}/sivacor/workflow_schema`)).json();
const diskProp = schema?.properties?.resources?.properties?.disk_gb;
check(
    'the published schema advertises resources.disk_gb',
    diskProp?.type === 'integer' && diskProp?.minimum === 1,
    JSON.stringify(diskProp)
);

// ----------------------------------------------------------------- the six items

const { page, close } = await open({ token });

// Nothing in this scenario may write. A page that POSTs or PUTs anything is a
// bug in this file, not a finding about production -- so record every non-GET
// the browser issues and assert on the list at the end.
const writes = [];
page.on('request', (req) => {
    const m = req.method();
    if (m !== 'GET' && m !== 'OPTIONS' && m !== 'HEAD') writes.push(`${m} ${req.url()}`);
});

try {
    // reachRunner, NOT resetToRunner: since #43 the only control that leaves the
    // monitor is "Delete & Run New Job", so resetToRunner would delete a real
    // production submission -- and this file's whole contract is that it writes
    // nothing. reachRunner gets to the same form with GETs only.
    check('the runner form is reachable without writing anything', await reachRunner(page));
    await sleep(1500);

    // -- 1: the control, enabled, empty, bounded ------------------------------
    const field = page.locator('#scratch-disk-input');
    check('the control is on the production form', (await field.count()) === 1);
    check('it is enabled for an approved account', !(await field.isDisabled()));
    check(
        'it starts empty, so no volume is still the default',
        (await field.inputValue()) === '',
        `"${await field.inputValue()}"`
    );
    check(
        `it is bounded by the ceiling, max="${CEILING}"`,
        (await field.getAttribute('max')) === String(CEILING),
        await field.getAttribute('max')
    );
    const title = await page.locator('#scratch-disk-section-title').innerText();
    check('the section is titled without "(by request)"', !/\(by request\)/.test(title), title);
    const hint = await page.locator('#scratch-disk-hint').innerText();
    check(
        'the hint names the real ceiling and the rounding',
        new RegExp(`${CEILING} GB`).test(hint) && new RegExp(`nearest ${GRAN} GB`).test(hint),
        hint.replace(/\s+/g, ' ').slice(0, 140)
    );
    check(
        'the approved hint does not read as a request route',
        !/support@sivacor\.org/.test(hint)
    );

    // -- 2: the rounding, shown as it is typed --------------------------------
    await field.fill(String(TYPED));
    await sleep(500);
    let body = await page.evaluate(() => document.body.innerText);
    check(
        `${TYPED} shows what it rounds up to`,
        new RegExp(`Rounds up to\\s*${ROUNDED} GB`).test(body),
        (body.match(/Rounds up to[^\n]*/) || ['?'])[0]
    );

    await field.fill(String(AT_EDGE));
    await sleep(500);
    body = await page.evaluate(() => document.body.innerText);
    check(
        `${AT_EDGE} rounds up to exactly the ceiling and is NOT refused`,
        new RegExp(`Rounds up to\\s*${CEILING} GB`).test(body) && !/more than your/.test(body),
        (body.match(/Rounds up to[^\n]*|more than your[^\n]*/) || ['?'])[0]
    );

    // -- 3: over the ceiling, refused in the form -----------------------------
    await field.fill(String(OVER));
    await sleep(500);
    body = await page.evaluate(() => document.body.innerText);
    check(
        'an over-ceiling request is refused live, naming the ceiling',
        new RegExp(`${OVER} GB of extra scratch disk is more than your ${CEILING} GB limit`).test(
            body
        ),
        (body.match(/more than your[^\n]*/) || ['?'])[0]
    );
    check(
        '...and says what to ask for instead',
        new RegExp(`Ask for ${CEILING} GB or less`).test(body)
    );
    check(
        'the refusal is announced, not just styled',
        (await page.locator('.disk-problem[role="alert"]').count()) === 1
    );
    await field.fill('');
    await sleep(400);
    body = await page.evaluate(() => document.body.innerText);
    check('clearing the field clears the refusal', !/more than your/.test(body));

    // -- 4: the importer, over and under the same ceiling ---------------------
    await page.locator('span.import-title').click();
    await sleep(500);
    let result = await importAndRead(page, workflowFile(CEILING + GRAN * 5));
    check(
        'an over-ceiling import is refused, naming the ceiling',
        /could not be imported/.test(result) &&
            new RegExp(`more than your ${CEILING} GB limit`).test(result),
        (result.match(/more than your[^\n]*/) || ['?'])[0]
    );
    check(
        'a refused import leaves the field alone',
        (await field.inputValue()) === '',
        `"${await field.inputValue()}"`
    );
    const grantable = Math.max(GRAN, CEILING - GRAN * 7);
    result = await importAndRead(page, workflowFile(grantable));
    check(
        `a grantable import (${grantable}) drives the control`,
        (await field.inputValue()) === String(grantable),
        await field.inputValue()
    );
    await field.fill('');

    // -- the finished runs items 5 and 6 need --------------------------------
    // Both legs of item 5 matter: a run that had a volume must export its
    // `disk_gb`, and a run that had none must export no such line at all.
    const types = encodeURIComponent(JSON.stringify(['sivacor_submission']));
    const jobs = await apiGet(
        `/job?types=${types}&userId=${me._id}&limit=50&sort=created&sortdir=-1`,
        token
    );
    const successes = jobs.filter((j) => j.status === 3);
    note(`${jobs.length} submissions for ${me.login}, ${successes.length} of them SUCCESS`);

    const collections = await apiGet('/collection?name=Submissions', token);
    const folderFor = async (jobId) => {
        if (!collections?.length) return null;
        const folders = await apiGet(
            `/folder?parentType=collection&parentId=${collections[0]._id}&jobId=${jobId}`,
            token
        );
        return folders?.[0] ?? null;
    };
    const peakDiskOf = async (folderId) => {
        const items = await apiGet(`/item?folderId=${folderId}&limit=200`, token);
        let peak = null;
        for (const item of items.filter((i) => /^performance_data_stage_\d+\.json$/.test(i.name))) {
            const r = await fetch(`${API}/item/${item._id}/download`, {
                headers: { 'Girder-Token': token },
            });
            if (!r.ok) continue;
            const value = (await r.json())?.MaxDiskUsage;
            if (typeof value === 'number' && (peak === null || value > peak)) peak = value;
        }
        return peak;
    };

    let withVolume = null;
    let withoutVolume = null;
    for (const job of successes) {
        const folder = await folderFor(job._id);
        if (!folder) continue;
        const asked = folder.meta?.requested_disk_gb ?? null;
        if (typeof asked === 'number' && !withVolume) withVolume = { job, folder, asked };
        if (asked === null && !withoutVolume) withoutVolume = { job, folder, asked };
        if (withVolume && withoutVolume) break;
    }
    check(
        'production has a finished run to export from',
        Boolean(withVolume || withoutVolume),
        `volume:${withVolume?.job?._id ?? 'none'} plain:${withoutVolume?.job?._id ?? 'none'}`
    );

    /** Download the exported workflow for one finished run. A GET, like any file. */
    const exportYaml = async (jobId) => {
        await page.goto(`${UI}/?jobId=${jobId}`, { waitUntil: 'networkidle' });
        await sleep(3500);
        const card = page.locator('.file-card', { hasText: 'Workflow definition' });
        if (!(await card.count())) return null;
        const download = await Promise.all([
            page.waitForEvent('download', { timeout: 30000 }),
            card.locator('button.download-button').click(),
        ]).then(([d]) => d);
        const out = path.join(os.tmpdir(), `sivacor-prod-export-${jobId}.yaml`);
        await download.saveAs(out);
        return fs.readFileSync(out, 'utf8');
    };

    // -- 5a: a run that had a volume exports it ------------------------------
    if (withVolume) {
        const yaml = await exportYaml(withVolume.job._id);
        check('the export is offered for the run that had a volume', Boolean(yaml));
        if (yaml) {
            check(
                `...and carries disk_gb: ${withVolume.asked}`,
                new RegExp(`^ {2}disk_gb: ${withVolume.asked}$`, 'm').test(yaml),
                (yaml.match(/^ *disk_gb:.*$/m) || ['no disk_gb line'])[0]
            );
            check(
                '...under one resources block, beside the memory size',
                (yaml.match(/^resources:$/gm) || []).length === 1 &&
                    /^ {2}memory_gb: \d+$/m.test(yaml),
                `${(yaml.match(/^resources:$/gm) || []).length} resources blocks`
            );
            check(
                '...and warns that importing it needs the reader\'s own allowance',
                /needs your own allowance/.test(yaml),
                (yaml.match(/^.*needs your own allowance.*$/m) || ['absent'])[0].trim()
            );
        }
    } else {
        note('no finished run with a volume on this account -- item 5a not exercised');
    }

    // -- 5b: a run that had none exports no disk_gb at all -------------------
    // Absent, not 0 and not null: absent is the only shape the server reads as
    // "no volume", so the export has to reproduce it exactly.
    if (withoutVolume) {
        const yaml = await exportYaml(withoutVolume.job._id);
        check('the export is offered for a run with no volume', Boolean(yaml));
        if (yaml) {
            check(
                '...and carries no disk_gb line at all',
                !/disk_gb/.test(yaml),
                (yaml.match(/^.*disk_gb.*$/m) || ['absent, correctly'])[0].trim()
            );
        }
    } else {
        note('no finished run without a volume on this account -- item 5b not exercised');
    }

    // -- 6: the peak-workspace hint -- NOT exercised here, deliberately ------
    // The hint is summarised from the run being left, so it only exists on the
    // way back from a finished submission. Before #43 that transition was the
    // free "Run New Job" button; it is now "Delete & Run New Job", so producing
    // the hint on production would cost a real researcher's submission. That is
    // not a trade this file may make -- it asserts below that it wrote nothing --
    // so the hint is covered on the dev stack instead, by
    // `volume-evidence.mjs`, which owns a submission it is allowed to destroy.
    const viewed = withoutVolume ?? withVolume;
    if (viewed) {
        const expected = await peakDiskOf(viewed.folder._id);
        note(
            `item 6 not exercised on production: reaching the hint now deletes a ` +
                `submission. The run it would quote is ${viewed.job._id}, whose peak ` +
                `workspace is ${formatBytes(expected)} -- check that figure by hand if ` +
                `the hint is what you are here for.`
        );
    } else {
        note('item 6 not exercised: no finished run to quote either');
    }
} finally {
    check(
        'the whole check wrote nothing: no non-GET request left the browser',
        writes.length === 0,
        writes.slice(0, 5).join(' ; ') || 'none'
    );
    await close();
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
