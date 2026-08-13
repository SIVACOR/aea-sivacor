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
   npm i -g playwright && npx playwright install chromium
   ```
3. `zip` on PATH (used once to build the fixture package).
4. A Docker image the worker can actually run, already pulled — `rocker/r-ver:4.6.1`
   is the cheap default (`docker pull rocker/r-ver:4.6.1`). Stata images need a
   license mount.

## Run

```bash
node e2e/monitor.mjs          # JobMonitor lifecycle: polling, refresh recovery, job identity
node e2e/runner.mjs           # JobRunner form: workflow-import panel, drop-zone hit areas
node e2e/workflow-export.mjs  # export a run's workflow definition and re-import it
```

Both exit non-zero on failure.

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
| submit | `button.run-button` |
| back to the runner | button matching `/run a new job|new job|new submission/i` |

Note the runner is only reachable when the monitor is in a terminal state — the
UI intentionally offers no way to submit while a job is active. To exercise the
409 concurrent-submission path you need two tabs: fill the form in tab A, submit
from tab B, then submit tab A.
