<script lang="ts">
    import { onMount, onDestroy } from "svelte";
    import { createEventDispatcher } from "svelte";
    import {
        fetchJobDetails,
        cancelJob,
        JOB_POLLING_INTERVAL,
        getLatestSubmission,
        getSubmissionByIdOrName,
        getSubmissionFolderUrl,
        downloadFile,
        getGirderToken,
        getGirderUrl,
        fetchPerformanceMetrics,
        deleteSubmission,
    } from "./api";
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
    let jobDetails: any = null;
    let jobStatusText: string | null = null;
    let errorMessage: string | null = null;
    let pollIntervalId: ReturnType<typeof setInterval> | null = null;
    let currentJobId: string | null = null;
    let checkingLatestSubmission = true;
    let latestSubmission: any = null;

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
        data: any;
    }> = [];
    let isLoadingMetrics = false;

    // Delete submission state
    let isDeletingSubmission = false;

    $: showRunner = !isMonitoring && !currentJobId && !checkingLatestSubmission;

    // Reactive check for polling state
    $: isJobActive = jobDetails && jobDetails.status < 3;

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
            if (meta[fileKey]) {
                files.push({
                    id: meta[fileKey],
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

    async function handleFileDownload(
        fileId: string,
        filename: string | undefined = undefined,
    ) {
        try {
            await downloadFile(fileId, filename);
        } catch (error) {
            console.error("Download failed:", error);
            alert(
                `Download failed: ${error instanceof Error ? error.message : "Unknown error"}`,
            );
        }
    }

    async function checkJobStatus(jobId: string) {
        try {
            const details = await fetchJobDetails(jobId);
            try {
                const submission = await getLatestSubmission();
                if (
                    submission &&
                    submission.meta &&
                    submission.meta.job_id === jobId
                ) {
                    latestSubmission = submission;
                }
            } catch (submissionError) {
                console.error(
                    "Error updating submission data:",
                    submissionError,
                );
            }

            if (details.status >= 3) {
                stopPolling();
                // Load performance metrics when job finishes (success or error)
                await loadPerformanceMetrics();
            }

            if (details.status === 4) {
                errorMessage =
                    (details as any).error ||
                    "The job encountered an unspecified error.";
            }

            jobDetails = details;
            jobStatusText =
                STATUS[details.status as keyof typeof STATUS] || "UNKNOWN";

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
        }
    }

    function startPolling(jobId: string) {
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
        stopPolling();
        disconnectFromLogs();
        jobDetails = null;
        jobStatusText = null;
        errorMessage = null;
        currentJobId = null;
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
            const submissionId = urlParams.get("submissionId");
            const submissionName = urlParams.get("submissionName");

            let submission = null;

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

            // If no URL parameter provided or submission not found, get the latest
            if (!submission) {
                submission = await getLatestSubmission();
            }

            latestSubmission = submission;

            if (submission && submission.meta && submission.meta.job_id) {
                currentJobId = submission.meta.job_id;
                if (currentJobId) {
                    startPolling(currentJobId);
                }
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
        !isMonitoring &&
        (!jobDetails || jobDetails.status < 3);

    // Use an effect to handle polling without creating infinite loops
    $: if (shouldPoll && currentJobId) {
        setTimeout(() => {
            if (currentJobId) {
                startPolling(currentJobId);
            }
        }, 0);
    }

    function handleJobSubmitted(event: any) {
        const newJobId = event.detail.jobId;
        currentJobId = newJobId;
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
            !latestSubmission ||
            !latestSubmission._id ||
            !latestSubmission.meta?.stages
        ) {
            return;
        }

        isLoadingMetrics = true;
        performanceMetrics = [];

        try {
            const stages = latestSubmission.meta.stages;

            // Fetch performance metrics for each stage
            const metricsPromises = stages.map(
                async (stage: any, index: number) => {
                    const stageNumber = index + 1;
                    const metrics = await fetchPerformanceMetrics(
                        latestSubmission._id,
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
                data: any;
            }>;
        } catch (error) {
            console.error("Error loading performance metrics:", error);
        } finally {
            isLoadingMetrics = false;
        }
    }

    function formatBytes(bytes: number): string {
        if (bytes === 0) return "0 B";
        const k = 1024;
        const sizes = ["B", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return (
            Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i]
        );
    }

    function formatDuration(startedAt: string, finishedAt: string): string {
        const start = new Date(startedAt);
        const finish = new Date(finishedAt);

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
            <JobRunner on:jobsubmitted={handleJobSubmitted} />
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
                {#if !isJobActive && getDownloadableFiles().length > 0}
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
                                    <button
                                        class="download-button"
                                        type="button"
                                        on:click={() =>
                                            handleFileDownload(file.id)}
                                    >
                                        <span class="material-icons"
                                            >download</span
                                        >
                                        Download
                                    </button>
                                </div>
                            {/each}
                        </div>
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

    .download-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-success);
        color: white;
        font-size: var(--md-font-body2);
        font-weight: 500;
        transition: all var(--md-transition-standard);
    }

    .download-button:hover {
        background-color: #45a049;
        box-shadow: var(--md-elevation-1);
    }

    .download-button:disabled {
        background-color: var(--md-outline-variant) !important;
        color: var(--md-on-surface-variant) !important;
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
