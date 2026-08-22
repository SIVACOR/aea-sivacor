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
