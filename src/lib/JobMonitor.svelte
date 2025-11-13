<script>
    import { onMount, onDestroy } from "svelte";
    import { get } from "svelte/store";
    import { user } from "./stores"; // Assuming user store is updated with full user model
    import {
        fetchJobDetails,
        cancelJob,
        JOB_POLLING_INTERVAL,
        submitJob,
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
    let latestSubmission = null; // Store the latest submission data

    $: showRunner = !isMonitoring && !currentJobId && !checkingLatestSubmission;

    // Reactive check for polling state
    $: isJobActive =
        jobDetails &&
        (jobDetails.status === 0 || // INACTIVE
            jobDetails.status === 1 || // QUEUED
            jobDetails.status === 2); // RUNNING

    // File type mappings for downloadable files
    const FILE_TYPE_LABELS = {
        sig_file_id: "TRS Signature",
        tro_file_id: "TRO Declaration",
        tsr_file_id: "Trusted Timestamp",
        stdout_file_id: "Run output log",
        stderr_file_id: "Run error log",
    };

    /**
     * Helper function to get downloadable files from latest submission metadata
     */
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

    /**
     * Handle file download using the downloadFile function
     */
    async function handleFileDownload(fileId, filename) {
        try {
            await downloadFile(fileId, filename);
        } catch (error) {
            console.error("Download failed:", error);
            // You could show an error message to the user here
            alert(`Download failed: ${error.message}`);
        }
    }

    /**
     * Polling function to check job status.
     */
    async function checkJobStatus(jobId) {
        try {
            const details = await fetchJobDetails(jobId);
            jobDetails = details;
            jobStatusText = STATUS[details.status] || "UNKNOWN";

            // If job is still active, also refresh the latest submission data
            // to get updated file metadata as they become available
            if (details.status < 3) {
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
                    // Don't fail the whole status check if submission update fails
                }
            }

            // If the job is finished (status >= 3: SUCCESS, ERROR, CANCELED), stop polling
            if (details.status >= 3) {
                // Do a final update of submission data when job completes
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
                        "Error updating final submission data:",
                        submissionError,
                    );
                }
                stopPolling();
                // Keep the currentJobId so we can display the final status, but prevent restart
            }

            // Handle specific status changes
            if (details.status === 4) {
                // ERROR
                errorMessage =
                    details.error ||
                    "The job encountered an unspecified error.";
            }
        } catch (e) {
            console.error("Error fetching job details:", e);
            errorMessage = "Could not fetch job status.";
            stopPolling();
        }
    }

    /**
     * Starts the polling process.
     */
    function startPolling(jobId) {
        isMonitoring = true;

        // Check once immediately
        checkJobStatus(jobId);

        // Then set up the interval
        pollIntervalId = setInterval(() => {
            checkJobStatus(jobId);
        }, JOB_POLLING_INTERVAL);
    }

    /**
     * Clears the polling interval.
     */
    function stopPolling() {
        if (pollIntervalId) {
            clearInterval(pollIntervalId);
            pollIntervalId = null;
        }
        isMonitoring = false;
    }

    /**
     * Attempts to cancel the current running job.
     */
    async function handleCancel() {
        if (!jobDetails || !jobDetails._id) return;

        jobStatusText = "Canceling...";

        try {
            await cancelJob(jobDetails._id);
            // Wait for the next poll to confirm CANCELED status from backend
        } catch (e) {
            console.error("Job cancellation failed:", e);
            jobStatusText = "Cancellation failed.";
        }
    }

    /**
     * Clears the current job and resets the UI to show the runner form.
     */
    function resetJob() {
        stopPolling();
        jobDetails = null;
        jobStatusText = null;
        errorMessage = null;
        currentJobId = null;
        latestSubmission = null; // Clear submission data when resetting
    }

    /**
     * Checks for the user's latest submission on component mount.
     */
    async function checkLatestSubmission() {
        try {
            checkingLatestSubmission = true;
            const submission = await getLatestSubmission();
            console.log("Latest submission:", submission);

            // Store the submission data for downloadable files
            latestSubmission = submission;

            if (submission && submission.meta && submission.meta.job_id) {
                currentJobId = submission.meta.job_id;
                startPolling(currentJobId);
            }
        } catch (error) {
            console.error("Error checking latest submission:", error);
            // Don't show error to user, just proceed without a job
        } finally {
            checkingLatestSubmission = false;
        }
    }

    // Lifecycle hook to check for latest submission when the component mounts
    onMount(() => {
        checkLatestSubmission();
    });

    // Cleanup hook to stop polling when the component is destroyed
    onDestroy(stopPolling);

    // Watch for changes in currentJobId - only start polling if job is not finished
    $: if (
        currentJobId &&
        !isMonitoring &&
        (!jobDetails || jobDetails.status < 3)
    ) {
        startPolling(currentJobId);
    }

    // Function to handle successful job submission from JobRunner
    function handleJobSubmitted(event) {
        const newJobId = event.detail.jobId;
        currentJobId = newJobId;
        // Clear latestSubmission since we have a new job
        latestSubmission = null;
        // The reactive block above will catch this change and start polling
    }
</script>

<div class="job-monitor-container">
    <h2>Job Status Monitor</h2>

    {#if showRunner}
        <!-- Display new JobRunner form if no active job -->
        <JobRunner on:jobsubmitted={handleJobSubmitted} />
    {:else if jobDetails}
        <!-- Display job details and status -->
        <div class="job-details card">
            <p><strong>Job ID:</strong> {jobDetails._id}</p>
            <p>
                <strong>Status:</strong>
                <span class="status-badge status-{jobDetails.status}">
                    {jobStatusText}
                </span>
            </p>

            {#if isJobActive}
                <div class="polling-info">
                    <p>Status is actively updating <span class="dot"></span></p>
                    <button
                        on:click={handleCancel}
                        disabled={jobDetails.status === 5 ||
                            jobStatusText === "Canceling..."}
                    >
                        Cancel Job
                    </button>
                </div>
            {:else if jobDetails.status === 3}
                <!-- SUCCESS -->
                <div class="result-message success">
                    <h3>✅ Job Completed Successfully!</h3>
                    <p>Results are ready for download/view.</p>
                    <!-- Display job results here (e.g., download link, image preview) -->
                    {#if jobDetails.resultPath}
                        <a href={jobDetails.resultPath} target="_blank"
                            >View Result</a
                        >
                    {/if}
                    <button on:click={resetJob} class="reset-button"
                        >Run New Job</button
                    >
                </div>
            {:else if jobDetails.status === 4}
                <!-- ERROR -->
                <div class="result-message error">
                    <h3>❌ Job Failed!</h3>
                    <p>
                        {errorMessage ||
                            "An error occurred during job execution."}
                    </p>
                    <pre>{jobDetails.log || "No error log available."}</pre>
                    <button on:click={resetJob} class="reset-button"
                        >Run New Job</button
                    >
                </div>
            {:else if jobDetails.status === 5}
                <!-- CANCELED -->
                <div class="result-message cancelled">
                    <h3>🛑 Job Canceled</h3>
                    <p>The job was manually canceled.</p>
                    <button on:click={resetJob} class="reset-button"
                        >Run New Job</button
                    >
                </div>
            {/if}

            <!-- Display logs if available -->
            {#if jobDetails.log && Array.isArray(jobDetails.log) && jobDetails.log.length > 0}
                <div class="logs-section">
                    <h4>Job Logs:</h4>
                    <div class="logs-container">
                        {#each jobDetails.log as logLine}
                            <div class="log-line">{logLine}</div>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Display downloadable files if job is not actively updating -->
            {#if !isJobActive && getDownloadableFiles().length > 0}
                <div class="files-section">
                    <h4>Downloadable Files:</h4>
                    <div class="files-container">
                        {#each getDownloadableFiles() as file}
                            <div class="file-item">
                                <span class="file-label">{file.label}</span>
                                <button
                                    on:click={() => handleFileDownload(file.id)}
                                    class="download-button"
                                    type="button"
                                >
                                    Download
                                </button>
                            </div>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    {:else}
        <p>Checking for previous jobs...</p>
    {/if}
</div>

<style>
    .job-monitor-container {
        padding: 20px;
        border: 1px solid #ccc;
        border-radius: 8px;
        margin-top: 20px;
        max-width: 550px;
    }
    .card {
        padding: 15px;
        background-color: #f9f9f9;
        border-radius: 6px;
    }
    .status-badge {
        display: inline-block;
        padding: 4px 8px;
        border-radius: 4px;
        font-weight: bold;
        color: white;
        margin-left: 5px;
    }
    .status-0,
    .status-1,
    .status-2 {
        background-color: #ffc107;
        color: #333;
    } /* INACTIVE, QUEUED, RUNNING (Yellow/Orange) */
    .status-3 {
        background-color: #28a745;
    } /* SUCCESS (Green) */
    .status-4 {
        background-color: #dc3545;
    } /* ERROR (Red) */
    .status-5 {
        background-color: #6c757d;
    } /* CANCELED (Grey) */

    .polling-info {
        display: flex;
        align-items: center;
        gap: 20px;
        margin-top: 10px;
    }
    .dot {
        height: 10px;
        width: 10px;
        background-color: #ffc107;
        border-radius: 50%;
        display: inline-block;
        animation: pulse 1.5s infinite;
    }
    @keyframes pulse {
        0% {
            opacity: 0.5;
        }
        50% {
            opacity: 1;
        }
        100% {
            opacity: 0.5;
        }
    }

    .result-message {
        padding: 15px;
        border-radius: 4px;
        margin-top: 15px;
    }
    .success {
        background-color: #e6ffed;
        border: 1px solid #28a745;
    }
    .error {
        background-color: #ffe6e6;
        border: 1px solid #dc3545;
    }
    .cancelled {
        background-color: #ebebeb;
        border: 1px solid #6c757d;
    }
    .reset-button {
        background-color: #007bff;
        color: white;
        border: none;
        padding: 8px 15px;
        border-radius: 4px;
        margin-top: 10px;
        cursor: pointer;
    }

    .logs-section {
        margin-top: 15px;
        padding: 10px;
        background-color: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 4px;
    }

    .logs-section h4 {
        margin: 0 0 10px 0;
        color: #495057;
        font-size: 14px;
        font-weight: bold;
    }

    .logs-container {
        max-height: 200px;
        overflow-y: auto;
        background-color: #ffffff;
        border: 1px solid #dee2e6;
        border-radius: 3px;
        padding: 8px;
    }

    .log-line {
        font-family: "Courier New", Consolas, monospace;
        font-size: 12px;
        line-height: 1.4;
        color: #212529;
        margin-bottom: 2px;
        white-space: pre-wrap;
        word-break: break-word;
    }

    .log-line:last-child {
        margin-bottom: 0;
    }

    .files-section {
        margin-top: 15px;
        padding: 10px;
        background-color: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 4px;
    }

    .files-section h4 {
        margin: 0 0 10px 0;
        color: #495057;
        font-size: 14px;
        font-weight: bold;
    }

    .files-container {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .file-item {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 8px 12px;
        background-color: #ffffff;
        border: 1px solid #dee2e6;
        border-radius: 3px;
    }

    .file-label {
        font-size: 13px;
        color: #495057;
        font-weight: 500;
    }

    .download-button {
        background-color: #28a745;
        color: white;
        border: none;
        padding: 4px 12px;
        border-radius: 3px;
        font-size: 12px;
        font-weight: bold;
        cursor: pointer;
        transition: background-color 0.2s;
    }

    .download-button:hover {
        background-color: #218838;
    }

    .download-button:disabled {
        background-color: #6c757d;
        cursor: not-allowed;
    }
</style>
