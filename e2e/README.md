# e2e — manual browser harness

Not part of CI and not wired into `npm test` (there is none). This is a
throw-a-scenario-at-the-real-stack harness for the bugs that only show up when
a real browser talks to a real Girder: leaked pollers, state that reverts a few
seconds after a click, WebSocket log streaming, OAuth-token handling.

Everything here is plain ESM run directly with `node`. No test framework.

## Prerequisites

1. The **deploy-dev** stack up (`cd ../../deploy-dev && make dev`). It
   bind-mounts this working tree and runs `npm run dev`, so edits are live —
   you can `git stash` mid-session and re-run to A/B a fix.
2. **playwright** importable from anywhere (deliberately *not* a dependency of
   this repo):
   ```bash
   npm i -g playwright
   ```
   Its browser download is **not** needed: the harness drives the system Chrome
   (`/usr/bin/google-chrome`) via `executablePath`. Point `SIVACOR_E2E_CHROME`
   somewhere else if your browser lives elsewhere, or set it empty to fall back
   to playwright's own build (`npx playwright install chromium`).
3. `zip` on PATH (used once to build the fixture package).
4. A Docker image the worker can actually run, already pulled — `rocker/r-ver:4.6.1`
   is the cheap default (`docker pull rocker/r-ver:4.6.1`). Stata images need a
   license mount.

## Run

```bash
node e2e/monitor.mjs          # JobMonitor lifecycle: polling, refresh recovery, job identity
node e2e/runner.mjs           # JobRunner form: workflow-import panel, drop-zone hit areas
node e2e/workflow-export.mjs  # export a run's workflow definition and re-import it
node e2e/volume-disk.mjs      # C4: the extra-scratch-disk control, as a non-admin
node e2e/volume-evidence.mjs  # C4: the peak-workspace hint and the disk_gb round trip
node e2e/upload-page.mjs      # #43: the Advanced fold, the run-button gate, the single button
```

All of them exit non-zero on failure.

`volume-disk.mjs` writes deployment settings (`sivacor.volumes_enabled`,
`sivacor.volume_total_gb`, `sivacor.targeted_assignment`) and the test account's
own ceiling, and restores every one of them in a `finally`. It has to drive
**MEMBER, not the admin**: site admins are deliberately *not* exempt from a
volume ceiling (unlike the worker-size group gate), so an admin sees the same
disabled control as everybody else and the approved half of the scenario cannot
be reached as one. It also cancels the submissions it makes — under targeted
assignment nothing consumes them on a stack with no fleet controller, and one
left RUNNING blocks that account's next submission with a 409.

`volume-evidence.mjs` is the half that needs a **finished** run, which is why it
is a separate file: asking for disk requires targeted assignment, and under that
flag nothing on a controller-less stack ever publishes the chain, so a submission
that asks for a volume can never complete here. It therefore runs an ordinary
submission — whose `MaxDiskUsage` is real, and is what the hint quotes — and
writes `meta.requested_disk_gb` onto that finished submission folder to exercise
the export. It removes the key afterwards by PUTting **null without
`allowNull=true`**; passing that parameter makes Girder *store* the null instead
of deleting the key, which is how the first run of this scenario left its own
test data behind.

`upload-page.mjs` covers issue #43 and owns two claims nothing else asserts.
It is the only scenario that calls `resetToRunner(page, { advanced: false })`:
everything else lets the helper unfold the Advanced panel, because a shut
`<details>` hides the size picker, the disk field and the secret rows from
`innerText()` as well as from clicks. And its upload-in-flight check needs a
fixture big enough to span more than one 5 MB chunk, so it builds a **60 MB
incompressible zip** in `$TMPDIR/sivacor-e2e-big` (kept between runs) — the
shared `makePackage()` fixture uploads inside a single tick, which is exactly how
the live-button bug went unnoticed.

## Two traps #43 introduced

**Leaving the monitor now deletes the submission.** The plain "Run New Job"
button is gone, so `resetToRunner()` clicks "Delete & Run New Job" and goes
through a `confirm()` — accepted by the dialog handler `open()` installs. Two
consequences worth knowing before writing a new scenario:

- Anything that needs the submission folder *after* the form is back must happen
  **before** the reset. `volume-evidence.mjs` reads as a worked example: its
  metadata patch and workflow-export download were moved above the reset for
  precisely this reason. The `previousRun` hints survive it, because `resetJob()`
  snapshots them from the monitor's own metrics rather than from the folder.
- Use **`reachRunner(page)`** instead where deleting is not acceptable — it gets
  to the same form with GETs only, by deep-linking a jobId the server cannot
  resolve (which sets the monitor's `jobUnavailable`). `volume-prod-check.mjs`
  uses it throughout, and that is also why its item 6 is now a printed note
  rather than a check: producing the previous-run hint requires the destructive
  transition, and that file's contract is that it writes nothing.

**`.delete-and-reset-button` is not unique.** FileUploader's "Delete Uploaded
File" reuses the class, so an unscoped locator on it hits whichever comes first.
Scope to the monitor's row: `.action-buttons-row button.delete-and-reset-button`.

To A/B a suspected regression:

```bash
git stash && node e2e/monitor.mjs      # expect failures
git stash pop && node e2e/monitor.mjs  # expect all pass
```

Override the domain with `SIVACOR_E2E_DOMAIN=…` (default `local.xarthisius.xyz`).

## Why it looks like this

- **Auth is a token, not OAuth.** ORCID/Globus can't be driven headlessly.
  `getToken()` does basic auth as the deploy-dev admin and the app is entered via
  `?girderToken=…`, which is exactly the post-OAuth entry path.
- **`submitJob()` returns the id from the `POST /sivacor/submit_job` response,
  never from the DOM.** When the monitor is what you're testing, the DOM is not
  a trustworthy witness to which job was created. `listJobs()` gives the same
  cross-check server-side.
- **`window.__probe` counts intervals and fetches** (`PROBE_INIT`, injected
  before app code). Poller leaks and redundant refetches are invisible in the
  DOM but obvious as `liveIntervals > 0` or a rising `metricLoads` on a job
  that already finished. Assert on behaviour, not on screenshots.
- **`watchShownJob()` / `watchForFlicker()` sample over time.** The interesting
  failures revert a second or two after the action, so a single assertion right
  after a click passes while the user still sees the bug.

## Selectors that matter

The runner form is uncontrolled markup, so these are the load-bearing hooks:

| what | selector |
|---|---|
| archive picker | `#file-input` |
| start the chunked upload | `button.upload-button` (upload is **not** automatic) |
| upload finished | body text `Upload Successful` |
| image / tag | `select[id^="image-select-"]` / `select[id^="tag-select-"]` |
| main file | `input[id^="execution-file-"]` |
| worker size | `#worker-size-select`, hint `#worker-size-hint` |
| extra scratch disk | `#scratch-disk-input`, hint `#scratch-disk-hint`, title `#scratch-disk-section-title` |
| last run's peaks | `#previous-run-memory` / `#previous-run-disk` — **not** `.previous-run`, which matches both |
| submit | `button.run-button` |
| back to the runner | button matching `/run a new job|new job|new submission/i` |

Note the runner is only reachable when the monitor is in a terminal state — the
UI intentionally offers no way to submit while a job is active. To exercise the
409 concurrent-submission path you need two tabs: fill the form in tab A, submit
from tab B, then submit tab A.
