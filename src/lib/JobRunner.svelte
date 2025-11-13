<script>
    import { onMount } from "svelte";
    import { createEventDispatcher } from "svelte";
    import { submitJob, getImages } from "./api";
    import FileUploader from "./FileUploader.svelte";

    // State for the dropdown
    let selectedOption = null;
    let options = [];
    let optionsLoading = true;

    // State for the file upload (will hold the ID when upload is done)
    /** @type {string | null} */
    let uploadedFileId = null;

    // State for the job execution
    let isJobRunning = false;
    let jobStatusMessage = "";
    let jobErrorMessage = null;
    let jobId = null;

    const dispatch = createEventDispatcher(); // <-- Initialize

    onMount(async () => {
        try {
            options = await getImages();
            if (options.length > 0) {
                selectedOption = options[0];
            }
        } catch (error) {
            console.error("Failed to load available images:", error);
            jobErrorMessage = "Failed to load available images.";
        } finally {
            optionsLoading = false;
        }
    });

    /**
     * Placeholder function for the FileUploader completion.
     * In a real implementation, FileUploader must be refactored to call this on success.
     * @param {CustomEvent<{fileId: string}>} event - Event containing the new file ID.
     */
    function handleUploadComplete(event) {
        uploadedFileId = event.detail.fileId;
        jobStatusMessage = `File uploaded! ID: ${uploadedFileId}. Ready to run job.`;
        console.log("Received uploaded file ID:", uploadedFileId);
    }

    async function runJob() {
        if (!uploadedFileId) {
            jobErrorMessage = "Please upload a file first.";
            return;
        }

        isJobRunning = true;
        jobErrorMessage = null;
        jobStatusMessage = `Starting job for option: ${selectedOption}...`;

        try {
            const jobResponse = await submitJob(uploadedFileId, selectedOption);
            jobId = jobResponse._id || "N/A"; // Assuming the response contains a job ID
            jobStatusMessage = `Job successfully started! Job ID: ${jobId}`;
            dispatch("jobsubmitted", { jobId: jobId });
        } catch (error) {
            console.error("Job submission failed:", error);
            jobErrorMessage =
                "Failed to submit job. Check console for details.";
            jobStatusMessage = "Job submission failed.";
        } finally {
            isJobRunning = false;
        }
    }
</script>

<div class="job-runner-container md-card">
    <div class="runner-header">
        <span class="material-icons runner-icon">play_circle</span>
        <h3>Create Processing Job</h3>
        <p class="runner-description">
            Upload your file and configure the processing parameters
        </p>
    </div>

    <div class="runner-content">
        <FileUploader on:uploadcomplete={handleUploadComplete} />

        <div class="divider">
            <span class="divider-text">Configuration</span>
        </div>

        <div class="config-section">
            <div class="input-group">
                <label for="option-select">
                    <span class="material-icons label-icon">settings</span>
                    Processing Type
                </label>
                {#if optionsLoading}
                    <div class="loading-state">
                        <div class="md-spinner"></div>
                        <span>Loading available images...</span>
                    </div>
                {:else if options.length > 0}
                    <select
                        id="option-select"
                        bind:value={selectedOption}
                        disabled={isJobRunning}
                    >
                        {#each options as option}
                            <option value={option}>{option}</option>
                        {/each}
                    </select>
                {:else}
                    <div class="error-state">
                        <span class="material-icons">warning</span>
                        <span>No processing images available</span>
                    </div>
                {/if}
            </div>

            <button
                on:click={runJob}
                disabled={!uploadedFileId || isJobRunning}
                class="run-button"
                class:running={isJobRunning}
            >
                {#if isJobRunning}
                    <div class="md-spinner"></div>
                    Processing...
                {:else}
                    <span class="material-icons">play_arrow</span>
                    Run Job with {selectedOption || "Selected Image"}
                {/if}
            </button>
        </div>

        {#if jobStatusMessage}
            <div
                class="status-banner"
                class:error={jobErrorMessage}
                class:success={!jobErrorMessage}
            >
                <span class="material-icons status-icon">
                    {jobErrorMessage ? "error" : "check_circle"}
                </span>
                <div class="status-content">
                    <div class="status-message">{jobStatusMessage}</div>
                    {#if jobId && !jobErrorMessage}
                        <div class="job-id">Job ID: {jobId}</div>
                    {/if}
                </div>
            </div>
        {/if}
    </div>
</div>

<style>
    .job-runner-container {
        margin-bottom: var(--md-spacing-lg);
    }

    .runner-header {
        text-align: center;
        margin-bottom: var(--md-spacing-xl);
        padding-bottom: var(--md-spacing-lg);
        border-bottom: 1px solid var(--md-outline-variant);
    }

    .runner-icon {
        font-size: 3rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-sm);
    }

    .runner-header h3 {
        margin: 0 0 var(--md-spacing-xs) 0;
        color: var(--md-on-surface);
    }

    .runner-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        margin: 0;
    }

    .runner-content {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-lg);
    }

    .divider {
        position: relative;
        text-align: center;
        margin: var(--md-spacing-lg) 0;
    }

    .divider::before {
        content: "";
        position: absolute;
        top: 50%;
        left: 0;
        right: 0;
        height: 1px;
        background-color: var(--md-outline-variant);
    }

    .divider-text {
        background-color: var(--md-surface);
        padding: 0 var(--md-spacing-md);
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        font-weight: 500;
        position: relative;
    }

    .config-section {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-lg);
    }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-sm);
    }

    .input-group label {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        font-weight: 500;
        color: var(--md-on-surface);
    }

    .label-icon {
        font-size: 20px;
        color: var(--md-primary);
    }

    .loading-state {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md);
        background-color: var(--md-surface-variant);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-body2);
        color: var(--md-on-surface-variant);
    }

    .error-state {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md);
        background-color: rgba(244, 67, 54, 0.1);
        color: var(--md-error);
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-body2);
    }

    select {
        appearance: none;
        background-image: url("data:image/svg+xml;charset=US-ASCII,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 5'><path fill='%23666' d='M2 0L0 2h4zm0 5L0 3h4z'/></svg>");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        padding-right: 40px;
    }

    .run-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md) var(--md-spacing-lg);
        background-color: var(--md-success);
        color: white;
        font-size: var(--md-font-body1);
        font-weight: 500;
        min-height: 56px;
        transition: all var(--md-transition-standard);
    }

    .run-button:hover:not(:disabled) {
        background-color: #45a049;
        box-shadow: var(--md-elevation-3);
        transform: translateY(-1px);
    }

    .run-button:active:not(:disabled) {
        transform: translateY(0);
    }

    .run-button.running {
        background-color: var(--md-warning);
    }

    .run-button:disabled {
        background-color: var(--md-outline-variant) !important;
        color: var(--md-on-surface-variant) !important;
        transform: none !important;
    }

    .status-banner {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-md);
        padding: var(--md-spacing-md);
        border-radius: var(--md-radius-sm);
        animation: slideIn 0.3s ease-out;
    }

    .status-banner.success {
        background-color: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
        color: var(--md-success);
    }

    .status-banner.error {
        background-color: rgba(244, 67, 54, 0.1);
        border: 1px solid rgba(244, 67, 54, 0.3);
        color: var(--md-error);
    }

    .status-icon {
        font-size: 1.5rem;
        margin-top: 2px;
    }

    .status-content {
        flex: 1;
    }

    .status-message {
        font-weight: 500;
        margin-bottom: var(--md-spacing-xs);
    }

    .job-id {
        font-size: var(--md-font-caption);
        opacity: 0.8;
        font-family: "Courier New", monospace;
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @media (max-width: 768px) {
        .runner-header {
            padding-bottom: var(--md-spacing-md);
        }

        .run-button {
            padding: var(--md-spacing-md);
            font-size: var(--md-font-body2);
        }

        .status-banner {
            flex-direction: column;
            text-align: center;
        }
    }
</style>
