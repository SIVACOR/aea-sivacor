<script>
    import { onMount, onDestroy } from "svelte";
    import {
        fetchJobDetails,
        cancelJob,
        JOB_POLLING_INTERVAL,
        getLatestSubmission,
        downloadFile,
    } from "./api";
    import JobRunner from "./JobRunner.svelte";

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
    let jobDetails = null;
    let jobStatusText = null;
    let errorMessage = null;
    let pollIntervalId = null;
    let currentJobId = null;
    let checkingLatestSubmission = true;
    let latestSubmission = null;

    $: showRunner = !isMonitoring && !currentJobId && !checkingLatestSubmission;

    // Reactive check for polling state
    $: isJobActive = jobDetails && jobDetails.status < 3;

    // File type mappings for downloadable files
    const FILE_TYPE_LABELS = {
        sig_file_id: "TRS Signature",
        tro_file_id: "TRO Declaration",
        tsr_file_id: "Trusted Timestamp",
        stdout_file_id: "Run output log",
        stderr_file_id: "Run error log",
    };

    function getDownloadableFiles() {
        if (!latestSubmission || !latestSubmission.meta) return [];
        const files = [];
        const meta = latestSubmission.meta;

        for (const [fileKey, label] of Object.entries(FILE_TYPE_LABELS)) {
            if (meta[fileKey]) {
                files.push({
                    id: meta[fileKey],
                    label: label,
                });
            }
        }
        return files;
    }

    async function handleFileDownload(fileId, filename) {
        try {
            await downloadFile(fileId, filename);
        } catch (error) {
            console.error("Download failed:", error);
            alert(`Download failed: ${error.message}`);
        }
    }

    async function checkJobStatus(jobId) {
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
            }

            if (details.status === 4) {
                errorMessage =
                    details.error ||
                    "The job encountered an unspecified error.";
            }

            jobDetails = details;
            jobStatusText = STATUS[details.status] || "UNKNOWN";
        } catch (e) {
            console.error("Error fetching job details:", e);
            errorMessage = "Could not fetch job status.";
            stopPolling();
        }
    }

    function startPolling(jobId) {
        isMonitoring = true;
        checkJobStatus(jobId);
        pollIntervalId = setInterval(() => {
            checkJobStatus(jobId);
        }, JOB_POLLING_INTERVAL);
    }

    function stopPolling() {
        if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
        }
        isMonitoring = false;
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
        jobDetails = null;
        jobStatusText = null;
        errorMessage = null;
        currentJobId = null;
        latestSubmission = null;
    }

    async function checkLatestSubmission() {
        try {
            checkingLatestSubmission = true;
            const submission = await getLatestSubmission();
            latestSubmission = submission;

            if (submission && submission.meta && submission.meta.job_id) {
                currentJobId = submission.meta.job_id;
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

    onDestroy(stopPolling);

    // Use a separate variable to track when we should start polling
    let shouldPoll = false;
    $: shouldPoll =
        currentJobId && !isMonitoring && (!jobDetails || jobDetails.status < 3);

    // Use an effect to handle polling without creating infinite loops
    $: if (shouldPoll && currentJobId) {
        setTimeout(() => {
            startPolling(currentJobId);
        }, 0);
    }

    function handleJobSubmitted(event) {
        const newJobId = event.detail.jobId;
        currentJobId = newJobId;
        latestSubmission = null;
    }

    function getStatusColor(status) {
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

    function getStatusIcon(status) {
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
</script>

<div class="job-monitor-container md-card">
    <div class="monitor-header">
        <span class="material-icons monitor-icon">monitor</span>
        <h2>SIVACOR Submission</h2>
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
                                        {latestSubmission.name}
                                    </div>
                                </div>
                            </div>
                        {/if}

                        <div class="job-id-info">
                            <span class="material-icons">fingerprint</span>
                            <div>
                                <div class="job-label">Job ID</div>
                                <div class="job-id">{jobDetails._id}</div>
                            </div>
                        </div>
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
                            on:click={handleCancel}
                            disabled={jobDetails.status === 5 ||
                                jobStatusText === "Canceling..."}
                            class="cancel-button"
                        >
                            <span class="material-icons">stop</span>
                            Cancel Job
                        </button>
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

                        <button on:click={resetJob} class="new-job-button">
                            <span class="material-icons">add</span>
                            Run New Job
                        </button>
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
                                <pre class="log-content">{jobDetails.log}</pre>
                            </div>
                        {/if}

                        <button on:click={resetJob} class="new-job-button">
                            <span class="material-icons">refresh</span>
                            Try Again
                        </button>
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

                        <button on:click={resetJob} class="new-job-button">
                            <span class="material-icons">add</span>
                            Run New Job
                        </button>
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
                                        on:click={() =>
                                            handleFileDownload(file.id)}
                                        class="download-button"
                                        type="button"
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
        text-align: center;
        margin-bottom: var(--md-spacing-xl);
        padding-bottom: var(--md-spacing-lg);
        border-bottom: 1px solid var(--md-outline-variant);
    }

    .monitor-icon {
        font-size: 3rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-sm);
    }

    .monitor-header h2 {
        margin: 0 0 var(--md-spacing-xs) 0;
        color: var(--md-on-surface);
    }

    .monitor-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        margin: 0;
    }

    .monitor-content {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-lg);
    }

    .job-details-card {
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-sm);
        padding: var(--md-spacing-lg);
        background-color: var(--md-surface-variant);
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-lg);
    }

    .job-header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--md-spacing-md);
    }

    .job-info {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .submission-info,
    .job-id-info {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
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

    .job-id {
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
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: rgba(var(--md-surface-tint-rgb), 0.08);
        border-radius: var(--md-radius-full);
        font-weight: 500;
    }

    .status-icon {
        font-size: 1.2rem;
    }

    .active-job-section {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: var(--md-spacing-md);
        background-color: rgba(var(--md-warning-rgb), 0.1);
        border: 1px solid rgba(var(--md-warning-rgb), 0.3);
        border-radius: var(--md-radius-sm);
    }

    .polling-indicator {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        color: var(--md-warning);
        font-weight: 500;
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

    .result-section {
        padding: var(--md-spacing-lg);
        border-radius: var(--md-radius-sm);
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
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
        gap: var(--md-spacing-md);
    }

    .result-icon {
        font-size: 2rem;
        margin-top: 2px;
    }

    .result-header h3 {
        margin: 0 0 var(--md-spacing-xs) 0;
        color: inherit;
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

    .new-job-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md) var(--md-spacing-lg);
        background-color: var(--md-primary);
        color: white;
        font-weight: 500;
        align-self: flex-start;
        margin-top: var(--md-spacing-sm);
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
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-md);
        color: var(--md-on-surface);
    }

    .section-header h4 {
        margin: 0;
        color: var(--md-on-surface);
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
        padding: var(--md-spacing-md);
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
        padding: var(--md-spacing-xxl);
        color: var(--md-on-surface-variant);
    }

    .empty-icon {
        font-size: 4rem;
        opacity: 0.5;
        margin-bottom: var(--md-spacing-md);
    }

    .empty-state h4 {
        margin: 0 0 var(--md-spacing-sm) 0;
        color: var(--md-on-surface-variant);
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
    }
</style>
