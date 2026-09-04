// Scenario: the cancel/delete race of 2026-09-03, from the browser.
//
//   node e2e/cancel-delete.mjs
//
// A cancel is a two-party operation. Girder revokes the task at once; the
// *worker* then spends around twelve seconds stopping the container and
// uploading the run's performance data, stdout, stderr and dockerstats. The
// folder used to be marked terminal on the first of those, so the monitor put
// a delete button in front of the user for the whole of the second -- and a
// researcher who took eight seconds to click it had their worker's first
// upload answered `No such folder`.
//
// Three things are checked here, none of which needs the scenario to *win* a
// race (the local worker settles a toy R package in about a second, so waiting
// for the real window would be a flake generator):
//
//   1. the Cancel button stays disabled across the poller's next ticks -- the
//      liveness bug that let the production job be cancelled twice, 2 s apart;
//   2. the server refuses to delete a submission whose folder says `canceling`,
//      and says something a human can act on; and
//   3. the monitor disables its own delete button while the folder says that,
//      and re-enables it on its own once the status settles -- the settle poll,
//      which is the only thing re-reading the folder after the job is terminal.
//
// (2) and (3) drive the status directly through PUT /folder/<id>/metadata as
// the admin, rather than trying to catch the worker mid-write-back. The
// endpoint under test reads meta.status and nothing else, so a forced value
// exercises exactly the code the real one does -- and the check is
// deterministic.
//
// See development_notes/incidents/2026-09-03-cancel-delete-race.md.

import {
    open,
    submitJob,
    resetToRunner,
    apiGet,
    bodyText,
    sleep,
    API,
    UI,
} from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const { page, token, close } = await open();

/** The submission folder for a job, once the worker has created it. */
async function waitForFolder(jobId, timeoutMs = 240000) {
    const collections = await apiGet('/collection?limit=50', token);
    const root = collections.find((c) => /submission/i.test(c.name));
    if (!root) throw new Error('no submissions collection on this stack');
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const found = await apiGet(
            `/folder?parentType=collection&parentId=${root._id}&jobId=${jobId}`,
            token
        );
        if (found.length) return found[0];
        await sleep(2000);
    }
    return null;
}

async function setFolderStatus(folderId, status) {
    const r = await fetch(`${API}/folder/${folderId}/metadata`, {
        method: 'PUT',
        headers: { 'Girder-Token': token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
    });
    if (!r.ok) throw new Error(`PUT metadata -> ${r.status} ${await r.text()}`);
    return (await r.json()).meta.status;
}

async function folderStatus(folderId) {
    return (await apiGet(`/folder/${folderId}`, token)).meta?.status ?? null;
}

/** The monitor's delete control, as the user sees it right now. */
const deleteButton = (page) =>
    page.evaluate(() => {
        const b = document.querySelector(
            '.action-buttons-row button.delete-and-reset-button'
        );
        return b ? { text: b.innerText.trim(), disabled: b.disabled } : null;
    });

// -- setup: one submission, cancelled --------------------------------------
await resetToRunner(page);
const sub = await submitJob(page);
if (sub.status !== 200 || !sub.id) {
    check('a submission to cancel', false, `${sub.status} ${sub.id ?? ''}`);
    await close();
    process.exit(1);
}
check('a submission to cancel', true, sub.id);

// -- 1. the Cancel button does not come back to life -----------------------
// jobStatusText used to carry this, and checkJobStatus reassigns it from the
// job document every 5 s -- so the button re-enabled between ticks. Sampled
// over 14 s, which is three ticks: a single assertion right after the click
// passed even with the bug.
const cancelButton = page.locator('button.cancel-button');
if (await cancelButton.count()) {
    await cancelButton.click();
    // D = disabled, E = enabled (the bug), - = the button is gone because the
    // job reached a terminal state. A toy R package finishes in seconds, so
    // the tail is usually dashes; what matters is that no E appears while it
    // is still there. Two D samples is one poller tick's worth, which is the
    // interval the old binding was re-enabled on.
    const states = [];
    for (let i = 0; i < 14; i++) {
        states.push(
            await page.evaluate(() => {
                const b = document.querySelector('button.cancel-button');
                return b ? (b.disabled ? 'D' : 'E') : '-';
            })
        );
        await sleep(1000);
    }
    check(
        'Cancel is never re-enabled by the poller once clicked',
        !states.includes('E') && states.filter((s) => s === 'D').length >= 2,
        states.join('')
    );
} else {
    // The run finished before the button could be clicked. Cancel it server
    // side so the rest of the scenario still has a cancelled job, and say so
    // rather than reporting a pass nobody checked.
    await fetch(`${API}/job/${sub.id}/cancel`, {
        method: 'PUT',
        headers: { 'Girder-Token': token },
    });
    check('Cancel is never re-enabled by the poller once clicked', false,
        'the run ended before the button appeared -- re-run, or use a slower package');
}

const folder = await waitForFolder(sub.id);
if (!folder) {
    check('the worker created a submission folder', false, 'none appeared');
    await close();
    process.exit(1);
}
check('the worker created a submission folder', true, folder._id);

// -- 2. the server refuses a delete while the folder is transitional -------
await setFolderStatus(folder._id, 'canceling');
const refused = await fetch(`${API}/sivacor/submission/${folder._id}`, {
    method: 'DELETE',
    headers: { 'Girder-Token': token },
});
const refusedBody = await refused.json().catch(() => ({}));
check(
    'DELETE is refused while the folder says canceling',
    refused.status === 400,
    `${refused.status} ${refusedBody.message ?? ''}`
);
check(
    '...with a message about the run still being saved, not "completed or failed"',
    /still saving/.test(refusedBody.message ?? ''),
    refusedBody.message
);
check(
    '...and the folder the worker is writing to is still there',
    (await folderStatus(folder._id)) === 'canceling'
);

// -- 3. the monitor disables its own button, then re-enables it ------------
// Reload rather than wait: the status was forced behind the app's back, and a
// fresh load is how a user arriving at a settling submission sees it.
await page.goto(`${UI}/?jobId=${sub.id}`, { waitUntil: 'networkidle', timeout: 120000 });
await sleep(6000);

const settling = await deleteButton(page);
check(
    'the monitor renders the delete control while settling',
    settling !== null,
    JSON.stringify(settling)
);
check(
    'the delete button is disabled while the folder says canceling',
    settling?.disabled === true,
    JSON.stringify(settling)
);
check(
    '...and says what it is waiting for rather than offering to delete',
    /finishing up/i.test(settling?.text ?? ''),
    settling?.text
);
const settlingText = await bodyText(page);
check(
    '...with a hint explaining the wait',
    /Saving the output produced before the job stopped/i.test(settlingText)
);

// The worker's own settle write, faked: this is what abandon() does once the
// last upload is in.
await setFolderStatus(folder._id, 'failed');

// The settle poll is a 3 s setTimeout chain -- nothing else re-reads the
// folder after the job is terminal, so if it were not running this would stay
// disabled forever. Sampled for 12 s, four times the interval.
let recovered = null;
for (let i = 0; i < 12; i++) {
    await sleep(1000);
    const state = await deleteButton(page);
    if (state && !state.disabled) {
        recovered = { state, seconds: i + 1 };
        break;
    }
}
check(
    'the settle poll notices on its own and re-enables the button',
    recovered !== null,
    recovered ? `after ${recovered.seconds}s: ${recovered.state.text}` : 'still disabled after 12s'
);
check(
    '...restored to the destructive wording, not left mid-state',
    /delete/i.test(recovered?.state.text ?? ''),
    recovered?.state.text
);

// -- 4. and the delete then works ------------------------------------------
const allowed = await fetch(`${API}/sivacor/submission/${folder._id}`, {
    method: 'DELETE',
    headers: { 'Girder-Token': token },
});
check(
    'DELETE is accepted once the status has settled',
    allowed.status === 200,
    `${allowed.status} ${await allowed.text()}`
);

await close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
