<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { createEventDispatcher } from "svelte";
    import {
        fetchJobDetails,
        cancelJob,
        JOB_POLLING_INTERVAL,
        getLatestSubmissionJob,
        getSubmissionByJobId,
        getSubmissionByIdOrName,
        getSubmissionFolderUrl,
        getImageTagsUrl,
        getFileDownloadUrl,
        getGirderToken,
        getGirderUrl,
        fetchPerformanceMetrics,
        deleteSubmission,
        containerMemoryLimit,
        type Folder,
        type JobDetails,
        type PerformanceMetrics,
        type PreviousRunPeaks,
        type WorkflowStage,
    } from "./api";
    import { formatBytes } from "./format";
    import JobRunner from "./JobRunner.svelte";

    const dispatch = createEventDispatcher();

    // Job Status mapping
    const STATUS = {
        0: "INACTIVE",
        1: "QUEUED",
        2: "RUNNING",
        3: "SUCCESS",
        4: "ERROR",
        5: "CANCELED",
    };

    // State
    let isMonitoring = false;
    let jobDetails: JobDetails | null = null;
    let jobStatusText: string | null = null;
    let errorMessage: string | null = null;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    let currentJobId: string | null = null;
    let checkingLatestSubmission = true;
    let latestSubmission: Folder | null = null;
    // Set when currentJobId names a job we could not load at all, so the
    // monitor falls back to the runner rather than to an inert empty state.
    let jobUnavailable = false;

    // WebSocket logs state
    let websocket: WebSocket | null = null;
    let isLogsVisible = false;
    let streamingLogs: Array<{
        timestamp: string;
        message: string;
        level: string;
    }> = [];
    let isConnectingToLogs = false;
    let logsConnectionError: string | null = null;
    let logsContainerElement: HTMLElement | null = null; // Reference to the logs container for scrolling

    // Log management constants
    const MAX_LOG_ENTRIES = 1000;

    // Copy to clipboard state
    let jobIdCopied = false;

    // Performance metrics state
    let performanceMetrics: Array<{
        stageNumber: number;
        stageName: string;
        data: PerformanceMetrics;
    }> = [];
    let isLoadingMetrics = false;

    // Delete submission state
    let isDeletingSubmission = false;

    /** Evidence for the resource controls: what the run the user just left came to. */
    let previousRun: PreviousRunPeaks | null = null;

    $: showRunner =
        !isMonitoring &&
        !checkingLatestSubmission &&
        (!currentJobId || jobUnavailable);

    // Reactive check for polling state
    $: isJobActive = jobDetails && jobDetails.status < 3;

    // The submission folder is created by the worker, as the first thing
    // prepare_submission does, so an active job without one has not been picked
    // up yet. (The job's own status is RUNNING from the moment it is submitted,
    // so it cannot tell us this.) Under one-VM-per-submission autoscaling this
    // wait is a cold boot -- a couple of minutes -- not an instant.
    $: isAwaitingWorker = isJobActive && !latestSubmission;

    // Written by the worker alongside the run's other metadata, so it is only
    // there once a submission folder exists. `meta` is an untyped Girder
    // document, so this is the one place the shape is asserted.
    $: submissionStages = Array.isArray(latestSubmission?.meta?.stages)
        ? (latestSubmission.meta.stages as WorkflowStage[])
        : [];
    $: hasWorkflowDefinition = submissionStages.length > 0;

    // The size this submission asked for, written to the folder by
    // prepare_submission so the exporter can see it. Absent on anything
    // submitted before the size was recorded at all, which is why the export
    // omits the block rather than guessing a figure.
    $: requestedMemoryGb =
        typeof latestSubmission?.meta?.requested_memory_gb === "number"
            ? (latestSubmission.meta.requested_memory_gb as number)
            : null;

    // The scratch volume this submission was granted, same source and same
    // caveat. Absent on a submission that asked for nothing -- and reliably so,
    // because Girder's metadata PUT treats a null as a *delete*, so the folder
    // carries the key only when there was a volume (C1 as built, finding 1).
    // That is what lets the export omit the field rather than write an explicit
    // null a re-import would have to interpret.
    $: requestedDiskGb =
        typeof latestSubmission?.meta?.requested_disk_gb === "number"
            ? (latestSubmission.meta.requested_disk_gb as number)
            : null;

    // File type mappings for downloadable files
    const FILE_TYPE_LABELS = {
        sig_file_id: { label: "TRS Signature", success: true },
        tro_file_id: { label: "TRO Declaration", success: true },
        tsr_file_id: { label: "Trusted Timestamp", success: true },
        stdout_file_id: { label: "Run output log", success: false },
        stderr_file_id: { label: "Run error log", success: false },
        replpack_file_id: { label: "Replicated Package", success: true },
    };

    function getDownloadableFiles() {
        if (!latestSubmission || !latestSubmission.meta) return [];
        const files = [];
        const meta = latestSubmission.meta;
        const jobStatus = jobDetails ? jobDetails.status : null;
        const isSuccess = jobStatus === 3;

        for (const [fileKey, entry] of Object.entries(FILE_TYPE_LABELS)) {
            if (entry.success && !isSuccess) {
                continue; // Skip success-only files if job not successful
            }
            const fileId = meta[fileKey];
            if (typeof fileId === "string" && fileId) {
                files.push({
                    id: fileId,
                    label: entry.label,
                });
            }
        }
        return files;
    }

    /**
     * Adds a log entry while maintaining the maximum log limit
     */
    function addLogEntry(logEntry: {
        timestamp: string;
        message: string;
        level: string;
    }) {
        streamingLogs.push(logEntry);
        if (streamingLogs.length > MAX_LOG_ENTRIES) {
            streamingLogs.shift();
        }
        // Reassign to trigger Svelte reactivity
        streamingLogs = streamingLogs;
    }

    /**
     * Clears all streaming logs
     */
    function clearLogs() {
        streamingLogs = [];
    }

    /**
     * Scrolls the logs container to the bottom
     */
    function scrollLogsToBottom() {
        if (logsContainerElement && isLogsVisible) {
            setTimeout(() => {
                if (logsContainerElement) {
                    logsContainerElement.scrollTop =
                        logsContainerElement.scrollHeight;
                }
            }, 0);
        }
    }

    async function connectToLogs() {
        try {
            isConnectingToLogs = true;
            logsConnectionError = null;

            const token = getGirderToken();
            const girderUrl = getGirderUrl();

            if (!token || !girderUrl) {
                throw new Error("Authentication required");
            }

            // Convert HTTP URL to WebSocket URL
            const wsUrl = girderUrl.replace(
                /^https?:/,
                girderUrl.startsWith("https:") ? "wss:" : "ws:",
            );
            const websocketUrl = `${wsUrl}/logs/docker?token=${encodeURIComponent(token)}`;

            if (websocket) {
                websocket.close();
                websocket = null;
            }
            websocket = new WebSocket(websocketUrl);
            const ws = websocket;

            ws.onopen = () => {
                console.log("WebSocket connection established for logs");
                // Check if disconnect was called during connection attempt
                if (!isConnectingToLogs) {
                    // Connection was cancelled, close immediately
                    ws.close();
                    if (websocket === ws) {
                        websocket = null;
                    }
                    return;
                }
                isConnectingToLogs = false;
            };

            ws.onmessage = async (event) => {
                try {
                    // Handle Blob data by converting to text
                    let messageData;
                    if (event.data instanceof Blob) {
                        messageData = await event.data.text();
                    } else {
                        messageData = event.data;
                    }

                    // Function to extract timestamp and message from log string
                    const parseLogMessage = (logString: string) => {
                        // Check if message starts with ISO timestamp pattern
                        const timestampRegex =
                            /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s*(.*)/;
                        const match = logString.match(timestampRegex);

                        if (match) {
                            return {
                                timestamp: match[1],
                                message: match[2].trim() || logString,
                            };
                        }

                        return {
                            timestamp: new Date().toISOString(),
                            message: logString,
                        };
                    };

                    // Try to parse as JSON first
                    try {
                        const logData = JSON.parse(messageData);
                        const parsed = parseLogMessage(
                            logData.message || messageData,
                        );
                        const logEntry = {
                            timestamp: parsed.timestamp,
                            message: parsed.message,
                            level: logData.level || "info",
                        };
                        addLogEntry(logEntry);
                    } catch {
                        // If not JSON, treat as plain text and parse timestamp
                        const parsed = parseLogMessage(messageData);
                        const logEntry = {
                            timestamp: parsed.timestamp,
                            message: parsed.message,
                            level: "info",
                        };
                        addLogEntry(logEntry);
                    }

                    // Auto-scroll to bottom if logs are visible
                    scrollLogsToBottom();
                } catch (error) {
                    console.error("Error processing log message:", error);
                }
            };

            websocket.onerror = (error) => {
                console.error("WebSocket error:", error);
                logsConnectionError = "Failed to connect to log stream";
                isConnectingToLogs = false;
                if (websocket) {
                    websocket.close();
                    websocket = null;
                }
            };

            websocket.onclose = () => {
                console.log("WebSocket connection closed");
                websocket = null;
                isConnectingToLogs = false;
            };
        } catch (error) {
            console.error("Error connecting to logs:", error);
            logsConnectionError =
                error instanceof Error ? error.message : "Unknown error";
            isConnectingToLogs = false;
        }
    }

    function disconnectFromLogs() {
        // Cancel any ongoing connection attempt
        if (isConnectingToLogs) {
            isConnectingToLogs = false;
        }

        // Close existing WebSocket connection
        if (websocket) {
            websocket.close();
            websocket = null;
        }

        clearLogs();
        logsConnectionError = null;
    }

    function toggleLogsVisibility() {
        isLogsVisible = !isLogsVisible;

        // Connect to logs when first opened during an active job
        if (isLogsVisible && isJobActive && !websocket && !isConnectingToLogs) {
            connectToLogs();
        }
    }

    /**
     * Serializes one value as a YAML scalar. JSON is a subset of YAML, so
     * JSON.stringify quotes and escapes correctly for every scalar we emit --
     * and it keeps `image_tag: "18"` a string, which bare 18 would not be.
     */
    function yamlScalar(value: unknown): string {
        return JSON.stringify(value);
    }

    /**
     * Renders the submission's stages as a workflow definition file, in the
     * exact shape WorkflowImport accepts, so a finished run can be handed to
     * someone else and re-submitted without retyping it (#38).
     *
     * Built by hand rather than with js-yaml because the comments are the point:
     * they tell the recipient where the authoritative image/tag list lives.
     * `meta.stages` carries no secrets -- those live encrypted on the job -- so
     * there is nothing here to strip, only the placeholder to document.
     */
    function buildWorkflowYaml(): string {
        const stages = submissionStages;
        const name = latestSubmission?.name ?? "submission";

        const header = [
            "# SIVACOR workflow definition",
            `# Exported from submission "${name}"` +
                (jobDetails?._id ? ` (job ${jobDetails._id})` : ""),
            "#",
            "# Import this file at the top of the submission form to recreate",
            "# these steps exactly.",
            "#",
            "# image_name and image_tag must be copied verbatim from the list",
            "# that fills the form's dropdowns:",
            `#   ${getImageTagsUrl()}`,
            "#",
            "# Secrets are never exported. If the run needs them, add:",
            "#   env_secrets:",
            '#     - key: API_TOKEN',
            '#       value: ""',
            "",
        ];

        // A peer of `stages`, at column 0, and only for what the submission
        // actually recorded: re-importing a file that names a rung the importer
        // cannot have fails, so an export that never asked for one must not
        // start asking. The same holds twice over for disk, which needs an
        // approval the recipient of this file may well not have.
        if (requestedMemoryGb !== null || requestedDiskGb !== null) {
            header.push(
                "# The machine this ran on. Remove this block to take the",
                "# defaults instead.",
                "resources:",
            );
            if (requestedMemoryGb !== null) {
                header.push(`  memory_gb: ${requestedMemoryGb}`);
            }
            if (requestedDiskGb !== null) {
                header.push(
                    `  disk_gb: ${requestedDiskGb}`,
                    "# ^ extra scratch disk, which needs approval per account.",
                    "#   Importing this needs your own allowance to cover it;",
                    "#   drop the line to run on the worker's own disk.",
                );
            }
            header.push("");
        }
        header.push("stages:");

        const body = stages.map((stage: WorkflowStage) =>
            [
                `  - image_name: ${yamlScalar(stage.image_name)}`,
                `    image_tag: ${yamlScalar(stage.image_tag)}`,
                `    main_file: ${yamlScalar(stage.main_file)}`,
                `    network_isolation: ${stage.network_isolation === true}`,
            ].join("\n"),
        );

        return `${header.join("\n")}\n${body.join("\n")}\n`;
    }

    /**
     * Offers the workflow definition as a download. Generated in the browser
     * from metadata already on screen -- there is no such file on the server.
     */
    function handleWorkflowDownload() {
        const name = latestSubmission?.name ?? "submission";
        const blob = new Blob([buildWorkflowYaml()], {
            type: "application/yaml",
        });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name}-workflow.yaml`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    async function checkJobStatus(jobId: string) {
        try {
            const details = await fetchJobDetails(jobId);
            // The user may have reset or submitted a new job while this was in
            // flight; adopting the response now would resurrect the old job.
            if (jobId !== currentJobId) return;

            try {
                // Not yet there while the job waits for a worker; this is what
                // picks it up once prepare_submission creates it.
                const submission = await getSubmissionByJobId(jobId);
                if (jobId !== currentJobId) return;
                if (submission) {
                    latestSubmission = submission;
                }
            } catch (submissionError) {
                console.error(
                    "Error updating submission data:",
                    submissionError,
                );
            }

            if (details.status === 4) {
                errorMessage =
                    details.error ||
                    "The job encountered an unspecified error.";
            }

            // Publish the terminal status *before* awaiting anything else:
            // shouldPoll keys off jobDetails, so leaving it stale across the
            // await below lets the effect restart polling on a finished job,
            // which re-enters here and reloads the metrics on a loop.
            jobDetails = details;
            jobStatusText =
                STATUS[details.status as keyof typeof STATUS] || "UNKNOWN";

            if (details.status >= 3) {
                stopPolling();
                // Load performance metrics when job finishes (success or error)
                await loadPerformanceMetrics();
            }

            // Dispatch job state update for title management
            dispatch("jobstateupdate", {
                status: jobStatusText,
                isRunning: isMonitoring,
                hasError: !!errorMessage,
                jobId: details._id,
            });
        } catch (e) {
            console.error("Error fetching job details:", e);
            errorMessage = "Could not fetch job status.";
            stopPolling();
            if (!jobDetails) {
                // The job never loaded at all -- most likely it no longer
                // exists. Give up on it instead of leaving the user on a "No
                // Active Jobs" screen they cannot act on, and stop shouldPoll
                // from immediately restarting the poll that just failed.
                jobUnavailable = true;
            }
        }
    }

    function startPolling(jobId: string) {
        // Idempotent: checkLatestSubmission awaits between setting currentJobId
        // and polling, so the shouldPoll effect can get here first. Without this
        // the earlier interval is orphaned and keeps polling a job the monitor
        // has already moved on from, clobbering the current one's state.
        if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
        }
        isMonitoring = true;
        checkJobStatus(jobId);
        pollIntervalId = setInterval(() => {
            checkJobStatus(jobId);
        }, JOB_POLLING_INTERVAL);

        // Auto-connect to logs if logs are visible
        if (isLogsVisible && !websocket && !isConnectingToLogs) {
            connectToLogs();
        }
    }

    function stopPolling() {
        if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
        }
        isMonitoring = false;

        // Disconnect from logs when job is no longer active
        disconnectFromLogs();
    }

    async function handleCancel() {
        if (!jobDetails || !jobDetails._id) return;
        jobStatusText = "Canceling...";
        try {
            await cancelJob(jobDetails._id);
        } catch (e) {
            console.error("Job cancellation failed:", e);
            jobStatusText = "Cancellation failed.";
        }
    }

    function resetJob() {
        // Before the clears below, which drop the metrics this reads.
        previousRun = summarisePreviousRun();
        stopPolling();
        disconnectFromLogs();
        jobDetails = null;
        jobStatusText = null;
        errorMessage = null;
        currentJobId = null;
        jobUnavailable = false;
        latestSubmission = null;
        isLogsVisible = false;
        streamingLogs = [];
        logsConnectionError = null;
        performanceMetrics = [];
        isLoadingMetrics = false;
        isDeletingSubmission = false;

        // Dispatch job reset for title management
        dispatch("jobreset", {
            status: "Dashboard",
        });
    }

    async function checkLatestSubmission() {
        try {
            checkingLatestSubmission = true;

            // Check for URL query parameters
            const urlParams = new URLSearchParams(window.location.search);
            const jobIdParam = urlParams.get("jobId");
            const submissionId = urlParams.get("submissionId");
            const submissionName = urlParams.get("submissionName");

            let submission = null;

            // ?jobId= addresses a submission by its job rather than its folder,
            // so it works even before a worker has created the folder. This is
            // what JobRunner's 409 banner links to.
            if (jobIdParam) {
                currentJobId = jobIdParam;
                latestSubmission = await getSubmissionByJobId(jobIdParam);
                startPolling(jobIdParam);
                return;
            }

            // Try to get submission by ID or name if provided in URL
            if (submissionId) {
                submission = await getSubmissionByIdOrName(submissionId);
                if (!submission) {
                    console.warn(
                        `Submission with ID "${submissionId}" not found. Falling back to latest submission.`,
                    );
                }
            } else if (submissionName) {
                submission = await getSubmissionByIdOrName(submissionName);
                if (!submission) {
                    console.warn(
                        `Submission with name "${submissionName}" not found. Falling back to latest submission.`,
                    );
                }
            }

            if (submission) {
                latestSubmission = submission;
                const metaJobId = submission.meta?.job_id;
                currentJobId = typeof metaJobId === "string" ? metaJobId : null;
            } else {
                // Recover from the job, not from the submission folder. The
                // folder is created on the worker by prepare_submission, so a
                // submission still waiting for one has no folder to be found
                // by -- and looking for the newest folder would silently
                // resurrect the *previous* submission instead. The job exists
                // from the moment it was submitted; its folder is an
                // enrichment that arrives once a worker picks the job up.
                const job = await getLatestSubmissionJob();
                if (job) {
                    currentJobId = job._id;
                    latestSubmission = await getSubmissionByJobId(job._id);
                }
            }

            if (currentJobId) {
                startPolling(currentJobId);
            }
        } catch (error) {
            console.error("Error checking latest submission:", error);
        } finally {
            checkingLatestSubmission = false;
        }
    }

    onMount(() => {
        checkLatestSubmission();
    });

    onDestroy(() => {
        stopPolling();
        disconnectFromLogs();
    });

    // Use a separate variable to track when we should start polling
    let shouldPoll = false;
    $: shouldPoll =
        !!currentJobId &&
        !jobUnavailable &&
        !isMonitoring &&
        (!jobDetails || jobDetails.status < 3);

    // Use an effect to handle polling without creating infinite loops
    $: if (shouldPoll && currentJobId) {
        setTimeout(() => {
            // Re-check: currentJobId may have changed (or polling may already
            // have started) between scheduling this and running it.
            if (shouldPoll && currentJobId) {
                startPolling(currentJobId);
            }
        }, 0);
    }

    function handleJobSubmitted(event: CustomEvent<{ jobId: string }>) {
        const newJobId = event.detail.jobId;
        currentJobId = newJobId;
        jobUnavailable = false;
        // The worker creates the submission folder; until it does, the monitor
        // shows the "waiting for a worker" state.
        latestSubmission = null;

        // Dispatch job submission for title management
        dispatch("jobsubmitted", {
            jobId: newJobId,
            status: "Submission in Progress",
        });
    }

    function getStatusColor(status: number): string {
        switch (status) {
            case 0:
            case 1:
            case 2:
                return "var(--md-warning)";
            case 3:
                return "var(--md-success)";
            case 4:
                return "var(--md-error)";
            case 5:
                return "var(--md-on-surface-variant)";
            default:
                return "var(--md-on-surface-variant)";
        }
    }

    function getStatusIcon(status: number): string {
        switch (status) {
            case 0:
            case 1:
                return "schedule";
            case 2:
                return "sync";
            case 3:
                return "check_circle";
            case 4:
                return "error";
            case 5:
                return "cancel";
            default:
                return "help";
        }
    }

    async function copyJobId() {
        if (!jobDetails || !jobDetails._id) return;
        try {
            await navigator.clipboard.writeText(jobDetails._id);
            jobIdCopied = true;
            setTimeout(() => {
                jobIdCopied = false;
            }, 2000);
        } catch (error) {
            console.error("Failed to copy job ID:", error);
        }
    }

    function formatTimestamp(timestamp: string): string {
        const date = new Date(timestamp);
        return isNaN(date.getTime()) ? "N/A" : date.toLocaleTimeString();
    }

    function formatFullDate(timestamp: string): string {
        const date = new Date(timestamp);
        if (isNaN(date.getTime())) return "N/A";
        return date.toLocaleString();
    }

    async function loadPerformanceMetrics() {
        if (
            isLoadingMetrics ||
            !latestSubmission ||
            !latestSubmission._id ||
            !latestSubmission.meta?.stages
        ) {
            return;
        }

        // Deliberately not cleared here: blanking the list up front makes any
        // reload flash the section out and back in. The results replace it
        // wholesale once they arrive.
        isLoadingMetrics = true;

        // Pinned before the awaits below: a reset mid-load would otherwise
        // leave these reads pointing at a different submission (or at null).
        const folderId = latestSubmission._id;
        const stages = submissionStages;

        try {
            // Fetch performance metrics for each stage
            const metricsPromises = stages.map(
                async (stage: WorkflowStage, index: number) => {
                    const stageNumber = index + 1;
                    const metrics = await fetchPerformanceMetrics(
                        folderId,
                        stageNumber,
                    );

                    if (metrics) {
                        return {
                            stageNumber,
                            stageName: `${stage.image_name}:${stage.image_tag} - ${stage.main_file}`,
                            data: metrics,
                        };
                    }
                    return null;
                },
            );

            const results = await Promise.all(metricsPromises);
            performanceMetrics = results.filter((m) => m !== null) as Array<{
                stageNumber: number;
                stageName: string;
                data: PerformanceMetrics;
            }>;
        } catch (error) {
            console.error("Error loading performance metrics:", error);
        } finally {
            isLoadingMetrics = false;
        }
    }

    /**
     * The peak memory and the cap of the run the user is leaving, kept for the
     * picker's evidence hint (S5 guard 1).
     *
     * Captured in resetJob(), because that is the only moment both facts are in
     * hand: the runner form is shown *because* the monitor was reset, and the
     * reset clears the metrics. Re-fetching them from JobRunner instead would
     * mean three more API calls and a second copy of loadPerformanceMetrics.
     *
     * Deliberately not carried over when the run being left has no metrics --
     * a deleted submission, or one that died before Docker emitted a reading.
     * Showing the run *before* last while the user was just looking at a
     * different one would be worse than showing nothing.
     *
     * Memory and disk are summarised independently and either may be null: the
     * memory figures come from a Docker stats CSV a run can die before writing,
     * while MaxDiskUsage is written from the poll loop's own reading. So "we
     * know the workspace but not the memory" is an ordinary outcome, and
     * returning null for the pair would throw away the half we have.
     */
    function summarisePreviousRun(): PreviousRunPeaks | null {
        // One submission runs on one machine, so the binding figure for each
        // resource is its worst stage, not the last one.
        const worstOf = (field: "MaxMemoryUsage" | "MaxDiskUsage") =>
            performanceMetrics
                .filter((metric) => typeof metric.data[field] === "number")
                .reduce(
                    (acc, metric) =>
                        acc === null ||
                        (metric.data[field] as number) >
                            (acc.data[field] as number)
                            ? metric
                            : acc,
                    null as (typeof performanceMetrics)[number] | null,
                );

        const worstMemory = worstOf("MaxMemoryUsage");
        const worstDisk = worstOf("MaxDiskUsage");
        if (worstMemory === null && worstDisk === null) {
            return null;
        }
        return {
            peakBytes: (worstMemory?.data.MaxMemoryUsage as number) ?? null,
            // The cap belongs to the memory peak's stage specifically: it is the
            // limit that peak was measured against, and a different stage's
            // limit would make the percentage meaningless.
            limitBytes: worstMemory
                ? containerMemoryLimit(worstMemory.data)
                : null,
            peakDiskBytes: (worstDisk?.data.MaxDiskUsage as number) ?? null,
        };
    }

    function formatDuration(
        startedAt: string | undefined,
        finishedAt: string | undefined,
    ): string {
        // ?? "" rather than a guard: an absent timestamp yields an Invalid
        // Date, which the isNaN check below already reports as N/A.
        const start = new Date(startedAt ?? "");
        const finish = new Date(finishedAt ?? "");

        if (isNaN(start.getTime()) || isNaN(finish.getTime())) {
            return "N/A";
        }

        const durationMs = finish.getTime() - start.getTime();
        const seconds = Math.floor(durationMs / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);

        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }

    async function handleDeleteAndReset() {
        if (!latestSubmission || !latestSubmission._id) {
            resetJob();
            return;
        }

        if (
            !confirm(
                `Are you sure you want to delete submission "${latestSubmission.name}"? This action cannot be undone.`,
            )
        ) {
            return;
        }

        isDeletingSubmission = true;
        try {
            await deleteSubmission(latestSubmission._id);
            resetJob();
        } catch (error) {
            console.error("Failed to delete submission:", error);
            alert(
                `Failed to delete submission: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
            isDeletingSubmission = false;
        }
    }
</script>

<div class="job-monitor-container md-card">
    <div class="monitor-header">
        <div class="header-title">
            <span class="material-icons monitor-icon">monitor</span>
            <h2>SIVACOR Submission</h2>
        </div>
        <p class="monitor-description">Track and manage your last job</p>
    </div>

    <div class="monitor-content">
        {#if showRunner}
            <!-- Display new JobRunner form if no active job -->
            <JobRunner {previousRun} on:jobsubmitted={handleJobSubmitted} />
        {:else if jobDetails}
            <!-- Display job details and status -->
            <div class="job-details-card">
                <div class="job-header">
                    <div class="job-info">
                        {#if latestSubmission}
                            <div class="submission-info">
                                <span class="material-icons">code</span>
                                <div>
                                    <div class="submission-label">
                                        Submission
                                    </div>
                                    <div class="submission-name">
                                        <a
                                            href={getSubmissionFolderUrl(
                                                latestSubmission,
                                            )}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                        >
                                            {latestSubmission.name}
                                        </a>
                                    </div>
                                </div>
                            </div>
                        {/if}

                        <div class="job-id-info">
                            <span class="material-icons">fingerprint</span>
                            <div class="job-id-content">
                                <div class="job-label">Job ID</div>
                                <div class="job-id">{jobDetails._id}</div>
                            </div>
                            <button
                                class="copy-job-id-button"
                                type="button"
                                title="Copy Job ID to clipboard"
                                aria-label={jobIdCopied
                                    ? "Copied Job ID"
                                    : "Copy Job ID"}
                                on:click={copyJobId}
                            >
                                <span class="material-icons" aria-hidden="true">
                                    {jobIdCopied ? "check" : "content_copy"}
                                </span>
                            </button>
                        </div>

                        {#if jobDetails.created}
                            <div class="job-timestamp-info">
                                <span class="material-icons">schedule</span>
                                <div>
                                    <div class="job-label">Submitted</div>
                                    <div class="job-timestamp">
                                        {formatFullDate(jobDetails.created)}
                                    </div>
                                </div>
                            </div>
                        {/if}
                        {#if jobDetails.updated}
                            <div class="job-timestamp-info">
                                <span class="material-icons">schedule</span>
                                <div>
                                    <div class="job-label">Last updated</div>
                                    <div class="job-timestamp">
                                        {formatFullDate(jobDetails.updated)}
                                    </div>
                                </div>
                            </div>
                        {/if}
                    </div>

                    <div class="job-status">
                        <div
                            class="status-badge"
                            style="color: {getStatusColor(jobDetails.status)}"
                        >
                            <span class="material-icons status-icon"
                                >{getStatusIcon(jobDetails.status)}</span
                            >
                            <span class="status-text">{jobStatusText}</span>
                        </div>
                    </div>
                </div>

                {#if isJobActive}
                    {#if isAwaitingWorker}
                        <div class="result-section waiting">
                            <div class="result-header">
                                <span class="material-icons result-icon"
                                    >hourglass_top</span
                                >
                                <div>
                                    <h3>Waiting for a worker</h3>
                                    <p>
                                        Your submission is queued. A machine is
                                        being started to run it, which usually
                                        takes a few minutes. This page updates
                                        itself &mdash; you can leave and come
                                        back to it.
                                    </p>
                                </div>
                            </div>
                        </div>
                    {/if}

                    <div class="active-job-section">
                        <div class="polling-indicator">
                            <div class="pulse-dot"></div>
                            <span>Status updating automatically</span>
                        </div>
                        <button
                            class="cancel-button"
                            on:click={handleCancel}
                            disabled={jobDetails.status === 5 ||
                                jobStatusText === "Canceling..."}
                        >
                            <span class="material-icons">stop</span>
                            Cancel Job
                        </button>
                    </div>

                    {#if !isAwaitingWorker}
                        <!-- Live Logs Section -->
                        <div class="live-logs-section">
                            <button
                                class="logs-toggle-button"
                                on:click={toggleLogsVisibility}
                                type="button"
                                aria-expanded={isLogsVisible}
                            >
                                <span
                                    class="material-icons logs-toggle-icon"
                                    class:expanded={isLogsVisible}
                                >
                                    {isLogsVisible ? "expand_less" : "expand_more"}
                                </span>
                                <span class="logs-toggle-text">
                                    Live Container Logs
                                    {#if streamingLogs.length > 0}
                                        <span class="logs-count"
                                            >({streamingLogs.length})</span
                                        >
                                    {/if}
                                </span>
                                {#if isConnectingToLogs}
                                    <div class="mini-spinner"></div>
                                {/if}
                            </button>

                            <!-- Clear Logs Button -->
                            {#if isLogsVisible && streamingLogs.length > 0}
                                <button
                                    class="clear-logs-button"
                                    on:click={clearLogs}
                                    type="button"
                                    title="Clear all logs"
                                >
                                    <span class="material-icons">clear_all</span>
                                    <span>Clear Logs</span>
                                </button>
                            {/if}

                            {#if isLogsVisible}
                                <div class="logs-content">
                                    {#if logsConnectionError}
                                        <div class="logs-error">
                                            <span class="material-icons">error</span
                                            >
                                            <span>{logsConnectionError}</span>
                                            <button
                                                class="retry-logs-button"
                                                disabled={isConnectingToLogs}
                                                on:click={connectToLogs}
                                            >
                                                Retry
                                            </button>
                                        </div>
                                    {:else if streamingLogs.length === 0 && !isConnectingToLogs}
                                        <div class="logs-empty">
                                            <span class="material-icons"
                                                >hourglass_empty</span
                                            >
                                            <span
                                                >Waiting for container logs...</span
                                            >
                                        </div>
                                    {:else}
                                        <div
                                            class="streaming-logs-container"
                                            role="log"
                                            aria-live="off"
                                            bind:this={logsContainerElement}
                                        >
                                            {#each streamingLogs as log, index (log.timestamp + "-" + index)}
                                                <div
                                                    class="log-entry"
                                                    data-level={log.level}
                                                >
                                                    <span class="log-timestamp">
                                                        {formatTimestamp(
                                                            log.timestamp,
                                                        )}
                                                    </span>
                                                    <span class="log-message">
                                                        {log.message}
                                                    </span>
                                                </div>
                                            {/each}
                                        </div>
                                    {/if}
                                </div>
                            {/if}
                        </div>
                    {/if}
                {:else if jobDetails.status === 3}
                    <!-- SUCCESS -->
                    <div class="result-section success">
                        <div class="result-header">
                            <span class="material-icons result-icon"
                                >check_circle</span
                            >
                            <div>
                                <h3>Job Completed Successfully!</h3>
                                <p>Results are ready for download and review</p>
                            </div>
                        </div>

                        {#if jobDetails.resultPath}
                            <a
                                href={jobDetails.resultPath}
                                target="_blank"
                                class="view-result-link"
                                rel="noopener noreferrer"
                            >
                                <span class="material-icons">open_in_new</span>
                                View Result
                            </a>
                        {/if}

                        <div class="action-buttons-row">
                            <button
                                on:click={resetJob}
                                class="new-job-button"
                                disabled={isDeletingSubmission}
                            >
                                <span class="material-icons">add</span>
                                Run New Job
                            </button>
                            <button
                                on:click={handleDeleteAndReset}
                                class="delete-and-reset-button"
                                disabled={isDeletingSubmission}
                            >
                                <span class="material-icons">
                                    {isDeletingSubmission
                                        ? "hourglass_empty"
                                        : "delete"}
                                </span>
                                {isDeletingSubmission
                                    ? "Deleting..."
                                    : "Delete & Run New Job"}
                            </button>
                        </div>
                    </div>
                {:else if jobDetails.status === 4}
                    <!-- ERROR -->
                    <div class="result-section error">
                        <div class="result-header">
                            <span class="material-icons result-icon">error</span
                            >
                            <div>
                                <h3>Job Failed</h3>
                                <p>
                                    {errorMessage ||
                                        "An error occurred during job execution"}
                                </p>
                            </div>
                        </div>

                        {#if jobDetails.log}
                            <div class="error-log">
                                <div class="log-header">
                                    <span class="material-icons"
                                        >description</span
                                    >
                                    <span>Error Log</span>
                                </div>
                                <pre class="log-content">{jobDetails.log.join(
                                        "",
                                    )}</pre>
                            </div>
                        {/if}

                        <div class="action-buttons-row">
                            <button
                                on:click={resetJob}
                                class="new-job-button"
                                disabled={isDeletingSubmission}
                            >
                                <span class="material-icons">refresh</span>
                                Try Again
                            </button>
                            <button
                                on:click={handleDeleteAndReset}
                                class="delete-and-reset-button"
                                disabled={isDeletingSubmission}
                            >
                                <span class="material-icons">
                                    {isDeletingSubmission
                                        ? "hourglass_empty"
                                        : "delete"}
                                </span>
                                {isDeletingSubmission
                                    ? "Deleting..."
                                    : "Delete & Try Again"}
                            </button>
                        </div>
                    </div>
                {:else if jobDetails.status === 5}
                    <!-- CANCELED -->
                    <div class="result-section canceled">
                        <div class="result-header">
                            <span class="material-icons result-icon"
                                >cancel</span
                            >
                            <div>
                                <h3>Job Canceled</h3>
                                <p>The job was manually canceled</p>
                            </div>
                        </div>

                        <div class="action-buttons-row">
                            <button
                                on:click={resetJob}
                                class="new-job-button"
                                disabled={isDeletingSubmission}
                            >
                                <span class="material-icons">add</span>
                                Run New Job
                            </button>
                            <button
                                on:click={handleDeleteAndReset}
                                class="delete-and-reset-button"
                                disabled={isDeletingSubmission}
                            >
                                <span class="material-icons">
                                    {isDeletingSubmission
                                        ? "hourglass_empty"
                                        : "delete"}
                                </span>
                                {isDeletingSubmission
                                    ? "Deleting..."
                                    : "Delete & Run New Job"}
                            </button>
                        </div>
                    </div>
                {/if}

                <!-- Display logs if available -->
                {#if jobDetails.log && Array.isArray(jobDetails.log) && jobDetails.log.length > 0}
                    <div class="logs-section">
                        <div class="section-header">
                            <span class="material-icons">description</span>
                            <h4>Job Logs</h4>
                        </div>
                        <div class="logs-container">
                            {#each jobDetails.log as logLine, index (index)}
                                <div class="log-line">{logLine}</div>
                            {/each}
                        </div>
                    </div>
                {/if}

                <!-- Display downloadable files if job is not actively updating -->
                {#if !isJobActive && (getDownloadableFiles().length > 0 || hasWorkflowDefinition)}
                    <div class="files-section">
                        <div class="section-header">
                            <span class="material-icons">file_download</span>
                            <h4>Downloadable Files</h4>
                        </div>
                        <div class="files-grid">
                            {#each getDownloadableFiles() as file (file.id)}
                                <div class="file-card">
                                    <div class="file-info">
                                        <span class="material-icons file-icon"
                                            >description</span
                                        >
                                        <span class="file-label"
                                            >{file.label}</span
                                        >
                                    </div>
                                    <!-- A real link, not a fetch: the browser
                                         then shows its own download progress
                                         from the first byte and streams to disk
                                         instead of buffering the whole package
                                         in the tab. No target=_blank -- Girder
                                         answers with Content-Disposition:
                                         attachment, so the page never navigates
                                         and a new tab would just be left behind
                                         empty. -->
                                    <a
                                        class="download-button"
                                        href={getFileDownloadUrl(file.id)}
                                    >
                                        <span class="material-icons"
                                            >download</span
                                        >
                                        Download
                                    </a>
                                </div>
                            {/each}

                            <!-- Not a server artifact like the others: built in
                                 the browser from the submission's stages, and
                                 offered for failed runs too so a broken setup
                                 can be handed on for someone else to fix. -->
                            {#if hasWorkflowDefinition}
                                <div class="file-card">
                                    <div class="file-info">
                                        <span class="material-icons file-icon"
                                            >tune</span
                                        >
                                        <span class="file-label"
                                            >Workflow definition</span
                                        >
                                    </div>
                                    <button
                                        class="download-button"
                                        type="button"
                                        on:click={handleWorkflowDownload}
                                    >
                                        <span class="material-icons"
                                            >download</span
                                        >
                                        Download
                                    </button>
                                </div>
                            {/if}
                        </div>
                        {#if hasWorkflowDefinition}
                            <p class="files-note">
                                The workflow definition re-creates this run's
                                steps in the submission form — hand it to a
                                colleague instead of dictating image names and
                                tags.
                            </p>
                        {/if}
                    </div>
                {/if}

                <!-- Display performance metrics if job finished -->
                {#if !isJobActive && performanceMetrics.length > 0}
                    <div class="performance-section">
                        <div class="section-header">
                            <span class="material-icons">speed</span>
                            <h4>Performance Metrics</h4>
                        </div>
                        {#each performanceMetrics as metric (metric.stageNumber)}
                            <div class="performance-stage">
                                <div class="stage-header">
                                    <span class="stage-badge"
                                        >Stage {metric.stageNumber}</span
                                    >
                                    <span class="stage-name"
                                        >{metric.stageName}</span
                                    >
                                </div>
                                <div class="metrics-grid">
                                    <div class="metric-card">
                                        <div class="metric-label">
                                            <span
                                                class="material-icons metric-icon"
                                                >schedule</span
                                            >
                                            <span>Duration</span>
                                        </div>
                                        <div class="metric-value">
                                            {formatDuration(
                                                metric.data.StartedAt,
                                                metric.data.FinishedAt,
                                            )}
                                        </div>
                                    </div>
                                    <div class="metric-card">
                                        <div class="metric-label">
                                            <span
                                                class="material-icons metric-icon"
                                                >memory</span
                                            >
                                            <span>Max CPU Usage</span>
                                        </div>
                                        <div class="metric-value">
                                            {metric.data.MaxCPUPercent
                                                ? `${metric.data.MaxCPUPercent.toFixed(2)}%`
                                                : "N/A"}
                                        </div>
                                    </div>
                                    <div class="metric-card">
                                        <div class="metric-label">
                                            <span
                                                class="material-icons metric-icon"
                                                >storage</span
                                            >
                                            <span>Max Memory Usage</span>
                                        </div>
                                        <div class="metric-value">
                                            {formatBytes(
                                                metric.data.MaxMemoryUsage,
                                            )}
                                        </div>
                                    </div>
                                    <div class="metric-card">
                                        <div class="metric-label">
                                            <span
                                                class="material-icons metric-icon"
                                                >computer</span
                                            >
                                            <span>CPUs Available</span>
                                        </div>
                                        <div class="metric-value">
                                            {metric.data.NCPU || "N/A"}
                                        </div>
                                    </div>
                                    <div class="metric-card">
                                        <div class="metric-label">
                                            <span
                                                class="material-icons metric-icon"
                                                >dns</span
                                            >
                                            <span>Total Memory</span>
                                        </div>
                                        <div class="metric-value">
                                            {formatBytes(metric.data.MemTotal)}
                                        </div>
                                    </div>
                                    <div class="metric-card">
                                        <div class="metric-label">
                                            <span
                                                class="material-icons metric-icon"
                                                >info</span
                                            >
                                            <span>OS</span>
                                        </div>
                                        <div class="metric-value os-info">
                                            {metric.data.OperatingSystem ||
                                                "N/A"}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        {/each}
                    </div>
                {:else if !isJobActive && isLoadingMetrics}
                    <div class="loading-metrics">
                        <div class="mini-spinner"></div>
                        <span>Loading performance metrics...</span>
                    </div>
                {/if}
            </div>
        {:else if checkingLatestSubmission}
            <div class="loading-state">
                <div class="md-spinner"></div>
                <span>Checking for previous jobs...</span>
            </div>
        {:else}
            <div class="empty-state">
                <span class="material-icons empty-icon">inbox</span>
                <h4>No Active Jobs</h4>
                <p>Create a new processing job to get started</p>
            </div>
        {/if}
    </div>
</div>

<style>
    .job-monitor-container {
        margin-bottom: var(--md-spacing-lg);
    }

    .monitor-header {
        margin-bottom: var(--md-spacing-md);
    }

    .header-title {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-xs);
    }

    .monitor-icon {
        font-size: 1.5rem;
        color: var(--md-primary);
    }

    .monitor-header h2 {
        margin: 0;
        color: var(--md-on-surface);
        font-size: 1.25rem;
    }

    .monitor-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0;
        padding-left: calc(1.5rem + var(--md-spacing-sm));
    }

    .monitor-content {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .job-details-card {
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-sm);
        padding: var(--md-spacing-md);
        background-color: var(--md-surface-variant);
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .job-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
    }

    .job-info {
        flex: 1;
        display: flex;
        flex-wrap: wrap;
        gap: var(--md-spacing-md);
    }

    .submission-info,
    .job-id-info,
    .job-timestamp-info {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-xs);
        flex: 1 1 auto;
        min-width: 180px;
    }

    .job-id-info {
        align-items: center;
    }

    .job-id-content {
        display: flex;
        flex-direction: column;
    }

    .submission-info .material-icons,
    .job-id-info .material-icons,
    .job-timestamp-info .material-icons {
        margin-top: 2px;
    }

    .copy-job-id-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        padding: var(--md-spacing-xs);
        background-color: transparent;
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        color: var(--md-on-surface-variant);
        cursor: pointer;
        transition: all var(--md-transition-standard);
        flex-shrink: 0;
    }

    .copy-job-id-button:hover {
        background-color: var(--md-surface-variant);
        color: var(--md-primary);
        border-color: var(--md-primary);
    }

    .copy-job-id-button .material-icons {
        font-size: 18px;
    }

    .copy-job-id-button:active {
        transform: scale(0.95);
    }

    .copy-job-id-button:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .submission-label,
    .job-label {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        font-weight: 500;
    }

    .submission-name {
        font-weight: 600;
        color: var(--md-primary);
    }

    .job-id,
    .job-timestamp {
        font-family: "Courier New", monospace;
        font-size: var(--md-font-body2);
        color: var(--md-on-surface);
    }

    .job-status {
        display: flex;
        align-items: center;
    }

    .status-badge {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 6px var(--md-spacing-sm);
        background-color: rgba(var(--md-surface-tint-rgb), 0.08);
        border-radius: var(--md-radius-full);
        font-weight: 500;
        font-size: var(--md-font-body2);
    }

    .status-icon {
        font-size: 1rem;
    }

    .active-job-section {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: rgba(var(--md-warning-rgb), 0.1);
        border: 1px solid rgba(var(--md-warning-rgb), 0.3);
        border-radius: var(--md-radius-sm);
    }

    .polling-indicator {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        color: var(--md-warning);
        font-weight: 500;
        font-size: var(--md-font-body2);
    }

    .pulse-dot {
        width: 10px;
        height: 10px;
        background-color: var(--md-warning);
        border-radius: 50%;
        animation: pulse 1.5s ease-in-out infinite;
    }

    .cancel-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-error);
        color: white;
        font-weight: 500;
    }

    .cancel-button:disabled {
        background-color: var(--md-outline-variant) !important;
        color: var(--md-on-surface-variant) !important;
    }

    .cancel-button:focus-visible {
        outline: 3px solid var(--md-error-dark);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(244, 67, 54, 0.3);
    }

    .live-logs-section {
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-sm);
        background-color: var(--md-surface);
        overflow: hidden;
    }

    .logs-toggle-button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background: transparent;
        border: none;
        text-align: left;
        font-weight: 500;
        font-size: var(--md-font-body2);
        color: var(--md-on-surface);
        cursor: pointer;
        transition: background-color var(--md-transition-standard);
    }

    .logs-toggle-button:hover {
        background-color: var(--md-surface-variant);
    }

    .logs-toggle-button:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: -2px;
        box-shadow: inset 0 0 0 4px rgba(25, 118, 210, 0.15);
    }

    .logs-toggle-icon {
        color: var(--md-primary);
        transition: transform var(--md-transition-standard);
    }

    .logs-toggle-icon.expanded {
        transform: rotate(0deg);
    }

    .logs-toggle-text {
        flex: 1;
    }

    .logs-count {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        font-weight: normal;
    }

    .mini-spinner {
        width: 16px;
        height: 16px;
        border: 2px solid var(--md-outline-variant);
        border-top: 2px solid var(--md-primary);
        border-radius: 50%;
        animation: spin 1s linear infinite;
    }

    .clear-logs-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        margin: var(--md-spacing-sm) var(--md-spacing-md) 0;
        background-color: var(--md-surface-variant);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-border-radius);
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        cursor: pointer;
        transition: all var(--md-transition-standard);
    }

    .clear-logs-button:hover {
        background-color: var(--md-secondary-container);
        color: var(--md-on-secondary-container);
        border-color: var(--md-secondary);
    }

    .clear-logs-button:focus-visible {
        outline: 3px solid var(--md-secondary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(3, 218, 198, 0.2);
    }

    .clear-logs-button .material-icons {
        font-size: 16px;
    }

    .logs-content {
        border-top: 1px solid var(--md-outline-variant);
        background-color: var(--md-surface-container-lowest);
    }

    :root {
        --md-logs-background: #1a1a1a;
        --md-logs-text: #e0e0e0;
    }

    .streaming-logs-container {
        max-height: 400px;
        overflow-y: auto;
        padding: var(--md-spacing-sm);
        background-color: var(--md-logs-background);
        color: var(--md-logs-text);
        font-family: "Courier New", monospace;
        font-size: 13px;
        line-height: 1.4;
    }

    .log-entry {
        display: flex;
        gap: var(--md-spacing-sm);
        padding: 2px 0;
        border-bottom: 1px solid transparent;
    }

    .log-entry[data-level="error"] {
        color: #ff6b6b;
    }

    .log-entry[data-level="warn"] {
        color: #ffa726;
    }

    .log-entry[data-level="info"] {
        color: #66bb6a;
    }

    .log-timestamp {
        color: #9e9e9e;
        font-size: 11px;
        white-space: nowrap;
        flex-shrink: 0;
        min-width: 80px;
    }

    .log-message {
        white-space: pre-wrap;
        word-break: break-word;
        flex: 1;
    }

    .logs-error {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md);
        background-color: rgba(var(--md-error-rgb), 0.1);
        color: var(--md-error);
        border: 1px solid rgba(var(--md-error-rgb), 0.3);
        margin: var(--md-spacing-sm);
        border-radius: var(--md-radius-xs);
    }

    .logs-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-xl);
        color: var(--md-on-surface-variant);
        font-style: italic;
    }

    .retry-logs-button {
        padding: var(--md-spacing-xs) var(--md-spacing-sm);
        background-color: var(--md-error);
        color: white;
        border: none;
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-caption);
        cursor: pointer;
        margin-left: auto;
    }

    .retry-logs-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .retry-logs-button:focus-visible {
        outline: 3px solid var(--md-error-dark);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(244, 67, 54, 0.3);
    }

    .result-section {
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border-radius: var(--md-radius-sm);
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-sm);
    }

    .result-section.success {
        background-color: rgba(var(--md-success-rgb), 0.1);
        border: 1px solid rgba(var(--md-success-rgb), 0.3);
        color: var(--md-success);
    }

    .result-section.error {
        background-color: rgba(var(--md-error-rgb), 0.1);
        border: 1px solid rgba(var(--md-error-rgb), 0.3);
        color: var(--md-error);
    }

    /* Deliberately the primary tint, not the warning one: this sits directly
       above the amber .active-job-section and needs to read as distinct. */
    .result-section.waiting {
        background-color: rgba(var(--md-primary-rgb), 0.08);
        border: 1px solid rgba(var(--md-primary-rgb), 0.3);
        color: var(--md-primary);
    }

    .result-section.canceled {
        background-color: rgba(var(--md-on-surface-variant-rgb), 0.1);
        border: 1px solid rgba(var(--md-on-surface-variant-rgb), 0.3);
        color: var(--md-on-surface-variant);
    }

    .result-header {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
    }

    .result-icon {
        font-size: 1.5rem;
        margin-top: 2px;
    }

    .result-header h3 {
        margin: 0 0 4px 0;
        color: inherit;
        font-size: 1.125rem;
    }

    .result-header p {
        margin: 0;
        opacity: 0.8;
    }

    .view-result-link {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        color: inherit;
        text-decoration: none;
        font-weight: 500;
        padding: var(--md-spacing-sm);
        border: 1px solid currentColor;
        border-radius: var(--md-radius-xs);
        transition: all var(--md-transition-standard);
        align-self: flex-start;
    }

    .view-result-link:hover {
        background-color: rgba(255, 255, 255, 0.1);
    }

    .view-result-link:focus-visible {
        outline: 3px solid currentColor;
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.1);
    }

    .action-buttons-row {
        display: flex;
        gap: var(--md-spacing-sm);
        flex-wrap: wrap;
        align-items: center;
    }

    .new-job-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-primary);
        color: white;
        font-size: var(--md-font-body2);
        font-weight: 500;
        margin-top: 0;
    }

    .new-job-button:focus-visible {
        outline: 3px solid var(--md-primary-dark);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.3);
    }

    .new-job-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .delete-and-reset-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-error);
        color: white;
        font-size: var(--md-font-body2);
        font-weight: 500;
        margin-top: 0;
    }

    .delete-and-reset-button:hover:not(:disabled) {
        background-color: #c62828;
        box-shadow: var(--md-elevation-1);
    }

    .delete-and-reset-button:focus-visible {
        outline: 3px solid var(--md-error-dark);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(244, 67, 54, 0.3);
    }

    .delete-and-reset-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }

    .error-log {
        margin-top: var(--md-spacing-md);
    }

    .log-header {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        margin-bottom: var(--md-spacing-sm);
        font-weight: 500;
    }

    .section-header {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        margin-bottom: var(--md-spacing-sm);
        color: var(--md-on-surface);
    }

    .section-header h4 {
        margin: 0;
        color: var(--md-on-surface);
        font-size: 1rem;
    }

    .logs-container {
        max-height: 300px;
        overflow-y: auto;
        background-color: var(--md-surface);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        padding: var(--md-spacing-md);
    }

    .log-line {
        font-family: "Courier New", monospace;
        font-size: var(--md-font-caption);
        line-height: 1.4;
        color: var(--md-on-surface);
        margin-bottom: 2px;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .log-content {
        margin: 0;
        padding: var(--md-spacing-md);
        background-color: var(--md-surface);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        font-family: "Courier New", monospace;
        font-size: var(--md-font-caption);
        color: var(--md-on-surface);
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 200px;
        overflow-y: auto;
    }

    .files-section {
        margin-top: var(--md-spacing-md);
    }

    .files-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
        gap: var(--md-spacing-md);
    }

    .files-note {
        margin-top: var(--md-spacing-sm);
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        line-height: 1.4;
    }

    .file-card {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-surface);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-sm);
        transition: all var(--md-transition-standard);
    }

    .file-card:hover {
        box-shadow: var(--md-elevation-1);
    }

    .file-info {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        flex: 1;
    }

    .file-icon {
        color: var(--md-primary);
    }

    .file-label {
        font-weight: 500;
        color: var(--md-on-surface);
    }

    .performance-section {
        margin-top: var(--md-spacing-md);
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .performance-stage {
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-sm);
        padding: var(--md-spacing-md);
        background-color: var(--md-surface);
    }

    .stage-header {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-md);
        flex-wrap: wrap;
    }

    .stage-badge {
        display: inline-flex;
        align-items: center;
        padding: 4px 12px;
        background-color: var(--md-primary);
        color: white;
        border-radius: var(--md-radius-full);
        font-size: var(--md-font-caption);
        font-weight: 600;
    }

    .stage-name {
        font-family: "Courier New", monospace;
        font-size: var(--md-font-body2);
        color: var(--md-on-surface-variant);
        flex: 1;
        word-break: break-word;
    }

    .metrics-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
        gap: var(--md-spacing-sm);
    }

    .metric-card {
        background-color: var(--md-surface-variant);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        padding: var(--md-spacing-sm);
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-xs);
    }

    .metric-label {
        display: flex;
        align-items: center;
        gap: 4px;
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        font-weight: 500;
    }

    .metric-icon {
        font-size: 16px;
    }

    .metric-value {
        font-size: 1.25rem;
        font-weight: 600;
        color: var(--md-on-surface);
        word-break: break-word;
    }

    .metric-value.os-info {
        font-size: var(--md-font-body2);
        font-weight: 500;
    }

    .loading-metrics {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md);
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
    }

    /* An <a>, so it has to restate what the global `button` rule would have
       given it: uppercase label, radius, min-height, no underline. */
    .download-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--md-spacing-xs);
        min-height: 36px;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-success);
        color: white;
        font-family: var(--md-font-family);
        font-size: var(--md-font-body2);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        text-decoration: none;
        border-radius: var(--md-radius-xs);
        cursor: pointer;
        transition: all var(--md-transition-standard);
    }

    .download-button:hover {
        background-color: #45a049;
        box-shadow: var(--md-elevation-1);
        color: white;
    }

    .download-button:focus-visible {
        outline: 3px solid var(--md-success);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(48, 110, 52, 0.3);
    }

    .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-xxl);
        color: var(--md-on-surface-variant);
    }

    .empty-state {
        text-align: center;
        padding: var(--md-spacing-xl);
        color: var(--md-on-surface-variant);
    }

    .empty-icon {
        font-size: 3rem;
        opacity: 0.5;
        margin-bottom: var(--md-spacing-sm);
    }

    .empty-state h4 {
        margin: 0 0 var(--md-spacing-xs) 0;
        color: var(--md-on-surface-variant);
        font-size: 1rem;
    }

    @keyframes pulse {
        0%,
        100% {
            opacity: 1;
            transform: scale(1);
        }
        50% {
            opacity: 0.5;
            transform: scale(1.2);
        }
    }

    @keyframes spin {
        0% {
            transform: rotate(0deg);
        }
        100% {
            transform: rotate(360deg);
        }
    }

    @media (max-width: 768px) {
        .job-header {
            flex-direction: column;
            gap: var(--md-spacing-md);
        }

        .active-job-section {
            flex-direction: column;
            gap: var(--md-spacing-md);
            text-align: center;
        }

        .result-header {
            flex-direction: column;
            text-align: center;
        }

        .files-grid {
            grid-template-columns: 1fr;
        }

        .file-card {
            flex-direction: column;
            gap: var(--md-spacing-sm);
            text-align: center;
        }

        .streaming-logs-container {
            max-height: 300px;
            font-size: 12px;
        }

        .log-timestamp {
            min-width: 70px;
            font-size: 10px;
        }

        .logs-error {
            flex-direction: column;
            text-align: center;
        }

        .metrics-grid {
            grid-template-columns: 1fr;
        }

        .stage-header {
            flex-direction: column;
            align-items: flex-start;
        }
    }
</style>
