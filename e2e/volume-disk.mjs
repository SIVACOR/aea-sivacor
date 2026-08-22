// Scenario: C4 -- the extra-scratch-disk control (cinder_volumes_plan.md).
//
//   node e2e/volume-disk.mjs
//
// **Runs as a non-admin, and that is the whole point of the scenario.** Two
// separate reasons, both of which have already cost a session:
//
//   - The closed side of the gate does not exist for an admin *of the worker
//     size* control, so the harness learned to drive MEMBER. Here the reason is
//     different and worth stating: an admin has `sivacorMaxVolumeGb = 0` like
//     everybody else -- site admins are deliberately NOT exempt from a *ceiling*
//     (C1 as built) -- so an admin-driven check of the approved side fails for a
//     reason that has nothing to do with the UI.
//   - `submit_job` takes the uploaded file at AccessType.ADMIN, so submitting
//     somebody else's package returns 403 *before any disk logic runs*, which
//     once read as the quota gate working. Every submission below is of a
//     package this account uploaded itself.
//
// The deployment settings and MEMBER's ceiling are set here and restored at the
// end. A crash in between leaves volumes enabled on a dev stack that has no
// fleet controller, which creates nothing -- harmless, but `make reset_girder`
// clears it.

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
} from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

/** The ceiling MEMBER is granted for the approved half of the scenario. */
const CEILING_GB = 50;
/** The deployment's reservation. Larger than the ceiling, so the ceiling binds. */
const DEPLOYMENT_GB = 100;

const adminToken = await getToken();
const memberToken = await getMemberToken(adminToken);
const member = await apiGet('/user/me', memberToken);

/** The admin-only route is the only way to approve an account. */
async function setQuota(gb) {
    const r = await fetch(`${API}/sivacor/user/${member._id}/volume_quota?maxGb=${gb}`, {
        method: 'PUT',
        headers: { 'Girder-Token': adminToken },
    });
    if (!r.ok) throw new Error(`PUT volume_quota -> ${r.status} ${await r.text()}`);
    // Read back through the caller's own endpoint, not the admin one: this is
    // the number the UI will render, and a setup step that silently no-ops is
    // how a scenario reports working code as broken.
    const seen = await apiGet('/sivacor/volume_quota', memberToken);
    if (seen.max_gb !== gb) throw new Error(`quota did not take: ${JSON.stringify(seen)}`);
    return seen;
}

const workflowFile = path.join(os.tmpdir(), 'sivacor-e2e-disk.yaml');
const writeWorkflow = (diskGb) => {
    fs.writeFileSync(
        workflowFile,
        `resources:
  disk_gb: ${diskGb}
stages:
  - image_name: rocker/r-ver
    image_tag: "4.6.1"
    main_file: main.R
`
    );
    return workflowFile;
};

/**
 * Get back to the runner form, however long the monitor takes to notice.
 *
 * A single resetToRunner() is not enough after a cancellation: the monitor polls
 * every 5 s, so the button that resets it does not exist until it has seen the
 * job leave RUNNING. Clicking into the void and then timing out on #file-input
 * reads as a broken form rather than as a scenario that asked too early.
 */
async function backToRunner(page, timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await page.locator('#file-input').count()) return true;
        await resetToRunner(page);
        await sleep(2500);
    }
    return false;
}

const importAndRead = async (page, file) => {
    await page.setInputFiles('#workflow-import-input', file);
    await page.waitForFunction(
        () => /Imported \d+ steps?|could not be imported/.test(document.body.innerText),
        null,
        { timeout: 60000 }
    );
    return page.evaluate(() => document.body.innerText);
};

/**
 * Leave no unfinished submission behind.
 *
 * Under targeted assignment `submit_job` returns a RUNNING job and publishes
 * nothing -- the fleet controller is supposed to pick it up, and this stack has
 * none, so it would stay RUNNING forever. `_active_submission` counts exactly
 * that state, so one leftover job blocks every future submission by this account
 * with a 409. Cancelling moves it out of ACTIVE_JOB_STATUSES.
 */
async function cancelSubmission(jobId) {
    for (const attempt of [
        () => fetch(`${API}/job/${jobId}/cancel`, { method: 'PUT', headers: { 'Girder-Token': adminToken } }),
        () => fetch(`${API}/job/${jobId}`, { method: 'DELETE', headers: { 'Girder-Token': adminToken } }),
    ]) {
        const r = await attempt();
        if (r.ok) break;
    }
    const active = await apiGet(
        `/job?types=${encodeURIComponent(JSON.stringify(['sivacor_submission']))}` +
            `&userId=${member._id}&limit=5&sort=created&sortdir=-1`,
        adminToken
    );
    // 0=INACTIVE 1=QUEUED 2=RUNNING are the statuses the 409 guard counts.
    return active.filter((job) => [0, 1, 2].includes(job.status)).length === 0;
}

const originals = {
    volumes_enabled: await apiGet('/system/setting?key=sivacor.volumes_enabled', adminToken),
    volume_total_gb: await apiGet('/system/setting?key=sivacor.volume_total_gb', adminToken),
    targeted_assignment: await apiGet('/system/setting?key=sivacor.targeted_assignment', adminToken),
};

try {
    // -- 1: the deployment offers volumes, this account is not approved -------
    // The common case, and the one an admin cannot see.
    await setSetting(adminToken, 'sivacor.volumes_enabled', true);
    await setSetting(adminToken, 'sivacor.volume_total_gb', DEPLOYMENT_GB);
    await setSetting(adminToken, 'sivacor.targeted_assignment', false);
    await setQuota(0);

    let asMember = await open({ token: memberToken });
    await resetToRunner(asMember.page);
    await sleep(1500);

    const input = asMember.page.locator('#scratch-disk-input');
    check('the control is on the form for an unapproved account', (await input.count()) === 1);
    check('...and is disabled', (await input.count()) === 1 && (await input.isDisabled()));
    const title = await asMember.page.locator('#scratch-disk-section-title').innerText();
    check('...and labelled "(by request)"', /\(by request\)/.test(title), title);
    let hint = await asMember.page.locator('#scratch-disk-hint').innerText();
    check('the hint names the request route', /support@sivacor\.org/.test(hint), hint);
    check('the hint does not offer a number nobody can have', !/up to 0 GB/.test(hint), hint);

    await asMember.page.locator('span.import-title').click();
    await sleep(400);
    let result = await importAndRead(asMember.page, writeWorkflow(20));
    check('an unapproved account cannot import a disk request',
        /could not be imported/.test(result) && /needs approval/.test(result),
        (result.match(/resources:[^\n]*/) || ['?'])[0].slice(0, 150));
    await asMember.close();

    // -- 2: an admin is not exempt from a ceiling ----------------------------
    // Unlike the worker-size group gate, which admins bypass by design. Asserted
    // because the opposite is the intuitive assumption, and assuming it is what
    // makes an admin-driven check of part 3 fail for the wrong reason.
    const asAdmin = await open();
    await resetToRunner(asAdmin.page);
    await sleep(1500);
    check('an admin sees the same disabled control as everyone else',
        (await asAdmin.page.locator('#scratch-disk-input').count()) === 1 &&
            (await asAdmin.page.locator('#scratch-disk-input').isDisabled()));
    await asAdmin.close();

    // -- 3: approved, and bounded by the ceiling -----------------------------
    await setQuota(CEILING_GB);
    asMember = await open({ token: memberToken });
    await resetToRunner(asMember.page);
    await sleep(1500);
    const field = asMember.page.locator('#scratch-disk-input');

    check('an approved account gets a usable control', !(await field.isDisabled()));
    check('it starts empty, so no volume is the default',
        (await field.inputValue()) === '', `"${await field.inputValue()}"`);
    check('it is bounded by the ceiling, not by the deployment reservation',
        (await field.getAttribute('max')) === String(CEILING_GB),
        await field.getAttribute('max'));
    hint = await asMember.page.locator('#scratch-disk-hint').innerText();
    check('the hint names the ceiling and the rounding',
        new RegExp(`${CEILING_GB} GB`).test(hint) && /nearest 10 GB/.test(hint), hint);
    check('the approved hint no longer reads as a request route',
        !/support@sivacor\.org/.test(hint), hint);
    check('the title drops "(by request)" once approved',
        !/\(by request\)/.test(await asMember.page.locator('#scratch-disk-section-title').innerText()));

    // Rounding is the server's, and it happens *before* the ceiling check, so
    // the figure that will be granted has to be visible while it is being typed.
    await field.fill('15');
    await sleep(400);
    let body = await asMember.page.evaluate(() => document.body.innerText);
    check('a request between steps shows what it rounds up to',
        /Rounds up to\s*20 GB/.test(body), (body.match(/Rounds up to[^\n]*/) || ['?'])[0]);

    await field.fill(String(CEILING_GB + 10));
    await sleep(400);
    body = await asMember.page.evaluate(() => document.body.innerText);
    check('an over-ceiling request is refused in the form, naming the ceiling',
        new RegExp(`more than your ${CEILING_GB} GB limit`).test(body),
        (body.match(/more than your[^\n]*/) || ['?'])[0]);
    check('the run button is not the only thing standing in the way',
        /Ask for 50 GB or less/.test(body));

    await field.fill('');
    await sleep(400);
    body = await asMember.page.evaluate(() => document.body.innerText);
    check('clearing the field clears the refusal', !/more than your/.test(body));

    // -- the import round-trip, which is how the one approved account works
    // today: there is no other way to ask until this control ships.
    await asMember.page.locator('span.import-title').click();
    await sleep(400);
    result = await importAndRead(asMember.page, writeWorkflow(CEILING_GB + 40));
    check('an over-ceiling import is refused, naming the ceiling',
        /could not be imported/.test(result) &&
            new RegExp(`more than your ${CEILING_GB} GB limit`).test(result),
        (result.match(/resources:[^\n]*/) || ['?'])[0].slice(0, 160));
    check('a refused import does not fill the field',
        (await field.inputValue()) === '', `"${await field.inputValue()}"`);

    result = await importAndRead(asMember.page, writeWorkflow(30));
    check('a grantable import drives the control',
        (await field.inputValue()) === '30', await field.inputValue());

    // -- 4: what actually goes on the wire -----------------------------------
    // Targeted assignment is still off here, so this is also the fifth refusal:
    // the controller reads the size only when it assigns, so on the shared-queue
    // path a volume would never be created however large a disk was asked for.
    const refused = await submitJob(asMember.page, { diskGb: 20, mainFile: 'main.R' });
    check('the form puts resources.disk_gb on the wire',
        refused.sent?.resources?.disk_gb === 20, JSON.stringify(refused.sent?.resources));
    check('without targeted assignment the request is refused, not accepted',
        refused.status === 400 && /cannot be provided on this deployment/.test(
            refused.body?.message ?? ''),
        `${refused.status} ${refused.body?.message ?? ''}`.slice(0, 120));

    // Armed, so the request can actually be honoured. A reload rather than a
    // fresh page: the quota is read on mount, and so is the refusal the form
    // just showed.
    await setSetting(adminToken, 'sivacor.targeted_assignment', true);
    await asMember.page.reload({ waitUntil: 'networkidle' });
    await sleep(2500);
    check('the form is reachable again after a refused submission',
        await backToRunner(asMember.page));

    const accepted = await submitJob(asMember.page, { diskGb: 20, mainFile: 'main.R' });
    check('an approved request is accepted once the fleet can honour it',
        accepted.status === 200 && accepted.id !== null,
        `${accepted.status} ${accepted.id ?? ''}`);
    if (accepted.id) {
        const job = await apiGet(`/job/${accepted.id}`, adminToken);
        check('the server records what was asked for, on the job',
            job?.meta?.requested_disk_gb === 20, JSON.stringify(job?.meta?.requested_disk_gb));
        check('the submission is cleaned up, so the account is not left blocked',
            await cancelSubmission(accepted.id));
    }

    // An empty field must send no `resources.disk_gb` at all -- not 0, not null.
    // Absent is the only value the server treats as "no volume", so this is the
    // check that the feature is still off by default from the form's side.
    check('the form comes back once the cancelled submission is noticed',
        await backToRunner(asMember.page));
    const plain = await submitJob(asMember.page, { diskGb: '', mainFile: 'main.R' });
    check('an empty field asks for nothing at all, rather than 0',
        plain.sent?.resources === undefined || plain.sent.resources.disk_gb === undefined,
        JSON.stringify(plain.sent?.resources));
    check('...and that submission is accepted', plain.status === 200, String(plain.status));
    if (plain.id) {
        const job = await apiGet(`/job/${plain.id}`, adminToken);
        check('...with no volume recorded against it',
            (job?.meta?.requested_disk_gb ?? null) === null,
            JSON.stringify(job?.meta?.requested_disk_gb));
        check('the second submission is cleaned up too', await cancelSubmission(plain.id));
    }

    await asMember.close();
} finally {
    await setQuota(0);
    for (const [key, value] of Object.entries(originals)) {
        await setSetting(adminToken, `sivacor.${key}`, value);
    }
    console.log('restored: settings and the test account\'s ceiling');
}

const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
