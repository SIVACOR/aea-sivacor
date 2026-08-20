// Scenario: JobMonitor lifecycle -- the flows that keep breaking.
//
//   node e2e/monitor.mjs
//
// Each check prints PASS/FAIL and the harness exits non-zero if any failed, so
// this doubles as a before/after A-B when bisecting a regression:
//   git stash && node e2e/monitor.mjs; git stash pop && node e2e/monitor.mjs

import {
    open,
    submitJob,
    waitTerminal,
    resetToRunner,
    shownJobId,
    jobStatus,
    readProbe,
    watchShownJob,
    watchForFlicker,
    bodyText,
    listJobs,
    sleep,
    UI,
} from './lib.mjs';

const checks = [];
const check = (name, ok, detail) => {
    checks.push({ name, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
};

const { page, token, close } = await open();

// -- 1. a finished job is the starting state -------------------------------
await resetToRunner(page);
let job1 = await shownJobId(page);
if (!job1) {
    const s = await submitJob(page);
    job1 = s.id;
    console.log(`submitted job #1 ${job1}`);
}
const st1 = await waitTerminal(page);
check('job runs to a terminal state', ['SUCCESS', 'ERROR'].includes(st1), st1);

// -- 2. reload with a finished job: no leaked pollers -----------------------
// The monitor's recovery path awaits between setting currentJobId and polling,
// which is where duplicate/orphaned intervals come from.
await page.goto(`${UI}/`, { waitUntil: 'networkidle', timeout: 120000 });
await sleep(8000);
const afterLoad = await readProbe(page);
check('no orphaned poll interval after reload', afterLoad.live === 0,
    `created=${afterLoad.created} live=${afterLoad.live}`);

// -- 3. a settled finished job stops doing work ----------------------------
const before = await readProbe(page);
const flicker = await watchForFlicker(page, 'Performance Metrics', 20);
const after = await readProbe(page);
const extraPolls =
    Object.values(after.jobPolls).reduce((a, b) => a + b, 0) -
    Object.values(before.jobPolls).reduce((a, b) => a + b, 0);
check('no polling after job finished', extraPolls === 0, `${extraPolls} polls in 20s`);
check('no metric reloads after job finished', after.metricLoads === before.metricLoads,
    `${after.metricLoads - before.metricLoads} reloads in 20s`);
check('metrics section does not flicker', flicker.sawFilled && flicker.blanks === 0,
    `filled=${flicker.sawFilled} blanks=${flicker.blanks}`);

// -- 4. "run a new job" actually switches to the new job -------------------
const oldJob = await shownJobId(page);
// P4.3: the peak the monitor is showing right now is what the picker's hint has
// to quote after the reset. Captured from the rendered table, not from the API,
// because agreeing with the *screen* is the claim -- the two are formatted by
// the same helper precisely so they cannot drift.
const shownPeak = ((await bodyText(page)).match(
    /Max Memory Usage\s*([\d.]+\s*[KMG]?B)/
) || [])[1];
await resetToRunner(page);

const hint = await page
    .locator('.previous-run')
    .innerText()
    .catch(() => null);
check('the picker quotes the last run once the form is back', Boolean(hint), hint);
check('the hint reads the peak the monitor showed',
    Boolean(shownPeak && hint && hint.includes(shownPeak.trim())),
    `monitor "${shownPeak}" vs hint "${hint}"`);
check('the peak is given as a fraction of what was allowed',
    Boolean(hint && /of the [\d.]+\s*[KMG]?B it was allowed \((<1|\d+)%\)/.test(hint)), hint);

const sub2 = await submitJob(page);
check('second submit accepted', sub2.status === 200 && sub2.id !== oldJob, `id=${sub2.id}`);

const timeline = await watchShownJob(page, 25);
const showingNew = timeline.filter((j) => j === sub2.id).length;
const showingOld = timeline.filter((j) => j === oldJob).length;
check('monitor stays on the new job', showingNew === timeline.length && showingOld === 0,
    `new=${showingNew}/${timeline.length} old=${showingOld} [${timeline
        .map((j) => (j === sub2.id ? 'N' : j === oldJob ? 'O' : '?'))
        .join('')}]`);
const p4 = await readProbe(page);
check('new job is the one being polled', (p4.jobPolls[sub2.id] || 0) > 0,
    JSON.stringify(p4.jobPolls));

// -- 5. reload mid-run resumes monitoring ----------------------------------
await page.goto(`${UI}/`, { waitUntil: 'networkidle', timeout: 120000 });
await sleep(3000);
const t5 = await bodyText(page);
check('mid-run reload does not fall back to the runner',
    !/RUN REPLICATION WORKFLOW/.test(t5) && !/No Active Jobs/.test(t5),
    (await jobStatus(page)) || 'no status');
const st5 = await waitTerminal(page);
check('resumed job reaches terminal state', ['SUCCESS', 'ERROR'].includes(st5), st5);

// -- 6. deep link ?jobId= (the 409 banner's recovery link) -----------------
await page.goto(`${UI}/?jobId=${sub2.id}`, { waitUntil: 'networkidle', timeout: 120000 });
await sleep(5000);
check('?jobId= deep link shows that job', (await bodyText(page)).includes(sub2.id));

// -- 7. UI agrees with the server ------------------------------------------
const jobs = await listJobs(token, 3);
check('newest server job is the one on screen', jobs[0]._id === (await shownJobId(page)) || jobs[0]._id === sub2.id,
    `server=${jobs[0]._id}`);

await close();
const failed = checks.filter((c) => !c.ok).length;
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed ? 1 : 0);
