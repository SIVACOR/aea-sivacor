<script>
    import { onMount } from "svelte";
    import { createEventDispatcher } from "svelte";
    import { submitJob, getImages } from "./api";
    import FileUploader from "./FileUploader.svelte";

    // State for the dropdowns
    /** @type {string | null} */
    let selectedImage = null;
    /** @type {string | null} */
    let selectedTag = null;
    /** @type {Record<string, string[]>} */
    let imagesData = {}; // Object with image names as keys and tag arrays as values
    /** @type {string[]} */
    let availableImages = []; // Array of image names
    /** @type {string[]} */
    let availableTags = []; // Array of tags for selected image
    let imagesLoading = true;

    // State for the file upload (will hold the ID when upload is done)
    /** @type {string | null} */
    let uploadedFileId = null;

    // State for the job execution
    let isJobRunning = false;
    let jobStatusMessage = "";
    /** @type {string | null} */
    let jobErrorMessage = null;
    /** @type {string | null} */
    let jobId = null;

    // State for the execution file name
    let executionFileName = "main.do";

    const dispatch = createEventDispatcher(); // <-- Initialize

    // Storage keys for persisting user preferences
    const STORAGE_KEYS = {
        selectedImage: "sivacor_selected_image",
        selectedTag: "sivacor_selected_tag",
        executionFileName: "sivacor_execution_filename",
    };

    /**
     * Save user selections to localStorage
     */
    function saveUserSelections() {
        try {
            if (selectedImage) {
                localStorage.setItem(STORAGE_KEYS.selectedImage, selectedImage);
            }
            if (selectedTag) {
                localStorage.setItem(STORAGE_KEYS.selectedTag, selectedTag);
            }
            if (executionFileName.trim()) {
                localStorage.setItem(
                    STORAGE_KEYS.executionFileName,
                    executionFileName,
                );
            }
        } catch (error) {
            console.warn(
                "Failed to save user selections to localStorage:",
                error,
            );
        }
    }

    /**
     * Load user selections from localStorage
     */
    function loadUserSelections() {
        try {
            const savedImage = localStorage.getItem(STORAGE_KEYS.selectedImage);
            const savedTag = localStorage.getItem(STORAGE_KEYS.selectedTag);
            const savedFileName = localStorage.getItem(
                STORAGE_KEYS.executionFileName,
            );

            // Restore execution file name first as it's independent
            if (savedFileName && savedFileName.trim()) {
                executionFileName = savedFileName;
            }

            // Only restore image if it's available
            if (savedImage && availableImages.includes(savedImage)) {
                selectedImage = savedImage;
            }

            // Tag restoration will be handled by the reactive statement
            // when availableTags is updated
        } catch (error) {
            console.warn(
                "Failed to load user selections from localStorage:",
                error,
            );
        }
    }

    /**
     * Clear saved user selections from localStorage
     */
    function clearUserSelections() {
        try {
            localStorage.removeItem(STORAGE_KEYS.selectedImage);
            localStorage.removeItem(STORAGE_KEYS.selectedTag);
            localStorage.removeItem(STORAGE_KEYS.executionFileName);
        } catch (error) {
            console.warn(
                "Failed to clear user selections from localStorage:",
                error,
            );
        }
    }

    // Reactive statement to update available tags when image selection changes
    $: {
        if (selectedImage && imagesData[selectedImage]) {
            availableTags = imagesData[selectedImage];

            // If no tag is selected or current tag is invalid for this image
            if (!selectedTag || !availableTags.includes(selectedTag)) {
                // Try to restore from localStorage first
                let newTag = null;

                try {
                    const savedTag = localStorage.getItem(
                        STORAGE_KEYS.selectedTag,
                    );
                    if (savedTag && availableTags.includes(savedTag)) {
                        newTag = savedTag;
                    }
                } catch (error) {
                    // Ignore localStorage errors
                }

                // If no saved tag or saved tag is invalid, use first available
                if (!newTag && availableTags.length > 0) {
                    newTag = availableTags[0];
                }

                selectedTag = newTag;
            }
        } else {
            availableTags = [];
            selectedTag = null;
        }
    }

    // Reactive statements to save user selections when they change
    $: if (selectedImage && availableImages.length > 0) {
        saveUserSelections();
    }

    $: if (selectedTag && availableTags.length > 0) {
        saveUserSelections();
    }

    $: if (executionFileName && executionFileName.trim()) {
        saveUserSelections();
    }

    // Computed reactive variable for button text to ensure proper updates
    $: buttonText =
        selectedImage && selectedTag
            ? `${selectedImage}:${selectedTag}`
            : "Selected Image";

    // Debug logging to track state changes
    /* $: console.log("JobRunner state:", {
        selectedImage,
        selectedTag,
        availableTags,
        buttonText,
    }); */

    onMount(async () => {
        try {
            imagesData = await getImages();
            availableImages = Object.keys(imagesData);

            if (availableImages.length > 0) {
                // Try to load saved selections first
                loadUserSelections();

                // If no saved image or saved image is invalid, select first available
                if (
                    !selectedImage ||
                    !availableImages.includes(selectedImage)
                ) {
                    selectedImage = availableImages[0];
                }
                // selectedTag will be set automatically by the reactive statement above
            }
        } catch (error) {
            console.error("Failed to load available images:", error);
            jobErrorMessage = "Failed to load available images.";
        } finally {
            imagesLoading = false;
        }
    }); /**
     * Placeholder function for the FileUploader completion.
     * In a real implementation, FileUploader must be refactored to call this on success.
     * @param {CustomEvent<{fileId: string}>} event - Event containing the new file ID.
     */
    function handleUploadComplete(event) {
        uploadedFileId = event.detail.fileId;
        jobStatusMessage = `File uploaded! ID: ${uploadedFileId}. Ready to run job.`;
        // console.log("Received uploaded file ID:", uploadedFileId);
    }

    async function runJob() {
        if (!uploadedFileId) {
            jobErrorMessage = "Please upload a file first.";
            return;
        }

        if (!executionFileName.trim()) {
            jobErrorMessage = "Please specify an execution file name.";
            return;
        }

        if (!selectedImage || !selectedTag) {
            jobErrorMessage = "Please select both an image and a tag.";
            return;
        }

        isJobRunning = true;
        jobErrorMessage = null;
        const fullImageName = `${selectedImage}:${selectedTag}`;
        jobStatusMessage = `Starting job for image: ${fullImageName} with file: ${executionFileName}...`;

        try {
            const jobResponse = await submitJob(
                uploadedFileId,
                fullImageName,
                executionFileName,
            );
            jobId = jobResponse._id || "N/A"; // Assuming the response contains a job ID
            jobStatusMessage = `Job successfully started! Job ID: ${jobId}`;
            dispatch("jobsubmitted", {
                jobId: jobId,
                executionFile: executionFileName,
                image: selectedImage,
                tag: selectedTag,
                fullImage: fullImageName,
            });
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
        <h3>New Submission</h3>
        <p class="runner-description">
            Upload a single file (tarball or zipball), choose a Docker image and
            tag, then specify your main execution file to run your job.
        </p>
    </div>

    <div class="runner-content">
        <FileUploader on:uploadcomplete={handleUploadComplete} />

        <div class="divider">
            <span class="divider-text">Configuration</span>
        </div>

        <div class="config-section">
            <div class="input-group">
                <label for="image-select">
                    <span class="material-icons label-icon">settings</span>
                    Docker Image
                </label>
                {#if imagesLoading}
                    <div class="loading-state">
                        <div class="md-spinner"></div>
                        <span>Loading available images...</span>
                    </div>
                {:else if availableImages.length > 0}
                    <select
                        id="image-select"
                        bind:value={selectedImage}
                        disabled={isJobRunning}
                    >
                        {#each availableImages as image (image)}
                            <option value={image}>{image}</option>
                        {/each}
                    </select>
                {:else}
                    <div class="error-state">
                        <span class="material-icons">warning</span>
                        <span>No processing images available</span>
                    </div>
                {/if}
            </div>

            <div class="input-group">
                <label for="tag-select">
                    <span class="material-icons label-icon">local_offer</span>
                    Image Tag
                </label>
                {#if imagesLoading}
                    <div class="loading-state">
                        <div class="md-spinner"></div>
                        <span>Loading available tags...</span>
                    </div>
                {:else if availableTags.length > 0}
                    <select
                        id="tag-select"
                        bind:value={selectedTag}
                        disabled={isJobRunning || !selectedImage}
                    >
                        {#each availableTags as tag (tag)}
                            <option value={tag}>{tag}</option>
                        {/each}
                    </select>
                {:else if selectedImage}
                    <div class="error-state">
                        <span class="material-icons">warning</span>
                        <span>No tags available for selected image</span>
                    </div>
                {:else}
                    <select disabled class="disabled-select">
                        <option>Select an image first</option>
                    </select>
                {/if}
            </div>

            <div class="input-group">
                <label for="execution-file">
                    <span class="material-icons label-icon">code</span>
                    Main Filename
                </label>
                <input
                    type="text"
                    id="execution-file"
                    bind:value={executionFileName}
                    disabled={isJobRunning}
                    placeholder="Enter main file name (e.g., main.do, main.R)"
                    class="file-input"
                />
                <div class="input-hint">
                    <span class="material-icons hint-icon">lightbulb</span>
                    Common values: <code>main.do</code> for Stata,
                    <code>main.R</code> for R
                </div>
            </div>

            <button
                on:click={runJob}
                disabled={!uploadedFileId ||
                    !executionFileName.trim() ||
                    !selectedImage ||
                    !selectedTag ||
                    isJobRunning}
                class="run-button"
                class:running={isJobRunning}
            >
                {#if isJobRunning}
                    <div class="md-spinner"></div>
                    Processing...
                {:else}
                    <span class="material-icons">play_arrow</span>
                    Run with {buttonText}
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

    .disabled-select {
        appearance: none;
        background-image: url("data:image/svg+xml;charset=US-ASCII,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 4 5'><path fill='%23999' d='M2 0L0 2h4zm0 5L0 3h4z'/></svg>");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        padding-right: 40px;
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
    }

    .file-input {
        padding: var(--md-spacing-md);
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        background-color: var(--md-surface);
        color: var(--md-on-surface);
        font-size: var(--md-font-body1);
        transition: border-color var(--md-transition-standard);
    }

    .file-input:focus {
        outline: none;
        border-color: var(--md-primary);
    }

    .file-input:disabled {
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
    }

    .input-hint {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        margin-top: var(--md-spacing-xs);
    }

    .hint-icon {
        font-size: 16px;
        color: var(--md-primary);
    }

    .input-hint code {
        background-color: var(--md-surface-variant);
        padding: 2px 6px;
        border-radius: var(--md-radius-xs);
        font-family: "Courier New", monospace;
        font-size: 0.875em;
        color: var(--md-on-surface);
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
