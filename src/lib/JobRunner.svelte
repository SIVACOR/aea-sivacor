<script lang="ts">
    import { onMount } from "svelte";
    import { createEventDispatcher } from "svelte";
    import { submitJob, getImages } from "./api";
    import FileUploader from "./FileUploader.svelte";
    import { hasInvalidOrcidEmail, user } from "./stores";
    import EmailUpdateModal from "./EmailUpdateModal.svelte";

    // State for the dropdowns data
    /** @type {Record<string, string[]>} */
    let imagesData: Record<string, string[]> = {}; // Object with image names as keys and tag arrays as values
    /** @type {string[]} */
    let availableImages: string[] = []; // Array of image names
    let imagesLoading = true;

    // State for the file upload (will hold the ID when upload is done)
    /** @type {string | null} */
    let uploadedFileId: string | null = null;

    // State for the job execution
    let isJobRunning = false;
    let jobStatusMessage = "";
    /** @type {string | null} */
    let jobErrorMessage: string | null = null;
    /** @type {string | null} */
    let jobId: string | null = null;

    // State for email update modal
    let showEmailModal = false;

    // Flag to prevent saving during initial load
    let isInitializing = true;

    // Configuration entries array - each entry represents a config row
    /** @type {Array<{id: string, selectedImage: string | null, selectedTag: string | null, executionFileName: string}>} */
    let configEntries: Array<{
        id: string;
        selectedImage: string | null;
        selectedTag: string | null;
        executionFileName: string;
    }> = [
        {
            id: crypto.randomUUID(),
            selectedImage: null,
            selectedTag: null,
            executionFileName: "main.do",
        },
    ];

    const dispatch = createEventDispatcher();

    // Storage keys for persisting user preferences
    const STORAGE_KEYS = {
        configEntries: "sivacor_config_entries",
    };

    /**
     * Save user selections to localStorage
     */
    function saveUserSelections() {
        try {
            // Save the entire config entries array
            const configToSave = configEntries.map((entry) => ({
                selectedImage: entry.selectedImage,
                selectedTag: entry.selectedTag,
                executionFileName: entry.executionFileName,
            }));
            localStorage.setItem(
                STORAGE_KEYS.configEntries,
                JSON.stringify(configToSave),
            );
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
            const savedConfigData = localStorage.getItem(
                STORAGE_KEYS.configEntries,
            );
            if (savedConfigData) {
                const parsedConfigs = JSON.parse(savedConfigData);
                if (Array.isArray(parsedConfigs) && parsedConfigs.length > 0) {
                    // Restore config entries with validation
                    configEntries = parsedConfigs.map((config) => ({
                        id: crypto.randomUUID(), // Generate new IDs
                        selectedImage:
                            config.selectedImage &&
                            availableImages.includes(config.selectedImage)
                                ? config.selectedImage
                                : null,
                        selectedTag: config.selectedTag || null,
                        executionFileName:
                            config.executionFileName || "main.do",
                    }));
                    console.log("Restored config entries:", configEntries);
                }
            } else {
                console.log("No saved config entries found in localStorage");
            }
        } catch (error) {
            console.warn(
                "Failed to load user selections from localStorage:",
                error,
            );
        }
    }

    // Reactive statements to save user selections when they change
    $: if (configEntries && configEntries.length > 0 && !isInitializing) {
        saveUserSelections();
    }

    // Computed reactive variable for button text
    $: firstEntry = configEntries[0];

    onMount(async () => {
        try {
            imagesData = await getImages();
            availableImages = Object.keys(imagesData);

            if (availableImages.length > 0) {
                // Try to load saved selections first
                loadUserSelections();

                // If no entries were loaded, ensure we have at least one with a default image
                if (configEntries.length === 0) {
                    configEntries = [
                        {
                            id: crypto.randomUUID(),
                            selectedImage: availableImages[0],
                            selectedTag: null,
                            executionFileName: "main.do",
                        },
                    ];
                }

                // Set tags for entries that have images but no tags
                configEntries.forEach((entry) => {
                    if (
                        entry.selectedImage &&
                        imagesData[entry.selectedImage] &&
                        !entry.selectedTag
                    ) {
                        const availableTags = imagesData[entry.selectedImage];
                        if (availableTags.length > 0) {
                            entry.selectedTag = availableTags[0];
                        }
                    }
                });
                configEntries = [...configEntries]; // Trigger reactivity
            }
        } catch (error) {
            console.error("Failed to load available images:", error);
            jobErrorMessage = "Failed to load available images.";
        } finally {
            imagesLoading = false;
            isInitializing = false; // Allow saving after initialization is complete
        }
    }); /**
     * Placeholder function for the FileUploader completion.
     * In a real implementation, FileUploader must be refactored to call this on success.
     * @param {CustomEvent<{fileId: string}>} event - Event containing the new file ID.
     */
    /**
     * @param {any} event - The upload complete event
     */
    function handleUploadComplete(event: any) {
        uploadedFileId = event.detail.fileId;
        jobStatusMessage = `File uploaded! ID: ${uploadedFileId}. Ready to run job.`;
    }

    /**
     * Add a new configuration entry
     */
    function addConfigEntry() {
        configEntries = [
            ...configEntries,
            {
                id: crypto.randomUUID(),
                selectedImage: null,
                selectedTag: null,
                executionFileName: "main.do",
            },
        ];
        // Saving will be triggered by the reactive statement
    }

    /**
     * Remove a configuration entry
     * @param {string} entryId - The ID of the entry to remove
     */
    function removeConfigEntry(entryId: string) {
        // Always keep at least one entry
        if (configEntries.length > 1) {
            configEntries = configEntries.filter(
                (entry) => entry.id !== entryId,
            );
            // Saving will be triggered by the reactive statement
        }
    }

    /**
     * Update available tags for a specific config entry when its image selection changes
     * @param {string} entryId - The ID of the entry
     * @param {string | null} selectedImage - The selected image
     */
    function updateEntryTags(entryId: string, selectedImage: string) {
        const entry = configEntries.find((e) => e.id === entryId);
        if (entry && selectedImage && imagesData[selectedImage]) {
            const availableTagsForImage = imagesData[selectedImage];

            // If current tag is not valid for this image, reset to first available
            if (
                !entry.selectedTag ||
                !availableTagsForImage.includes(entry.selectedTag)
            ) {
                entry.selectedTag = availableTagsForImage[0] || null;
                configEntries = [...configEntries]; // Trigger reactivity and save
            }
        }
    }

    async function runJob() {
        if (!uploadedFileId) {
            jobErrorMessage = "Please upload a file first.";
            return;
        }

        const firstEntry = configEntries[0];
        if (!firstEntry) {
            jobErrorMessage = "No configuration available.";
            return;
        }

        if (!firstEntry.executionFileName.trim()) {
            jobErrorMessage = "Please specify an execution file name.";
            return;
        }

        if (!firstEntry.selectedImage || !firstEntry.selectedTag) {
            jobErrorMessage = "Please select both an image and a tag.";
            return;
        }

        isJobRunning = true;
        jobErrorMessage = null;
        const fullImageName = `${firstEntry.selectedImage}:${firstEntry.selectedTag}`;
        jobStatusMessage = `Starting job for image: ${fullImageName} with file: ${firstEntry.executionFileName}...`;

        try {
            const validConfig = configEntries.filter(
                (entry) =>
                    entry.selectedImage &&
                    entry.selectedTag &&
                    entry.executionFileName,
            ) as Array<{
                id: string;
                selectedImage: string;
                selectedTag: string;
                executionFileName: string;
            }>;

            if (validConfig.length === 0) {
                throw new Error("No valid configuration entries to submit");
            }

            const response = await submitJob(uploadedFileId, validConfig);
            jobId = response._id || "N/A";
            jobStatusMessage = `Job successfully started! Job ID: ${jobId}`;
            dispatch("jobsubmitted", {
                jobId: jobId,
                executionFile: firstEntry.executionFileName,
                image: firstEntry.selectedImage,
                tag: firstEntry.selectedTag,
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
        <div class="header-title">
            <span class="material-icons runner-icon">play_circle</span>
            <h3>New Submission</h3>
        </div>
        <p class="runner-description">
            Upload a file, select Docker image and tag, then specify your main
            execution file.
        </p>
    </div>

    <div class="runner-content">
        <FileUploader on:uploadcomplete={handleUploadComplete} />

        <div class="config-section">
            {#each configEntries as entry, index (entry.id)}
                <div class="config-row">
                    <div class="step-badge">{index + 1}</div>
                    <div class="config-widgets">
                        <!-- Docker Image Selection -->
                        <div class="input-group">
                            <label for="image-select-{entry.id}">
                                Docker Image
                            </label>
                            {#if imagesLoading}
                                <div class="loading-state">
                                    <div class="md-spinner"></div>
                                    <span>Loading...</span>
                                </div>
                            {:else if availableImages.length > 0}
                                <select
                                    id="image-select-{entry.id}"
                                    bind:value={entry.selectedImage}
                                    on:change={() =>
                                        entry.selectedImage &&
                                        updateEntryTags(
                                            entry.id,
                                            entry.selectedImage,
                                        )}
                                    disabled={isJobRunning}
                                >
                                    <option value={null}>Select Image</option>
                                    {#each availableImages as image (image)}
                                        <option value={image}>{image}</option>
                                    {/each}
                                </select>
                            {:else}
                                <div class="error-state">
                                    <span class="material-icons">warning</span>
                                    <span>No images available</span>
                                </div>
                            {/if}
                        </div>

                        <!-- Image Tag Selection -->
                        <div class="input-group">
                            <label for="tag-select-{entry.id}">
                                Image Tag
                            </label>
                            {#if imagesLoading}
                                <div class="loading-state">
                                    <div class="md-spinner"></div>
                                    <span>Loading...</span>
                                </div>
                            {:else if entry.selectedImage && imagesData[entry.selectedImage]?.length > 0}
                                <select
                                    id="tag-select-{entry.id}"
                                    bind:value={entry.selectedTag}
                                    disabled={isJobRunning ||
                                        !entry.selectedImage}
                                >
                                    {#each imagesData[entry.selectedImage] as tag (tag)}
                                        <option value={tag}>{tag}</option>
                                    {/each}
                                </select>
                            {:else if entry.selectedImage}
                                <div class="error-state">
                                    <span class="material-icons">warning</span>
                                    <span>No tags available</span>
                                </div>
                            {:else}
                                <select disabled class="disabled-select">
                                    <option>Select an image first</option>
                                </select>
                            {/if}
                        </div>

                        <!-- Main Filename -->
                        <div class="input-group">
                            <label for="execution-file-{entry.id}">
                                Main Filename
                            </label>
                            <input
                                type="text"
                                id="execution-file-{entry.id}"
                                bind:value={entry.executionFileName}
                                disabled={isJobRunning}
                                placeholder="e.g., main.do, main.R"
                                class="file-input"
                            />
                            <div class="input-hint">
                                💡 Common: <code>main.do</code> (Stata),
                                <code>main.R</code> (R)
                            </div>
                        </div>
                    </div>

                    <!-- Remove button (only show if more than one entry) -->
                    {#if configEntries.length > 1}
                        <button
                            type="button"
                            class="remove-config-btn"
                            on:click={() => removeConfigEntry(entry.id)}
                            disabled={isJobRunning}
                            title="Remove this configuration"
                        >
                            <span class="material-icons">remove</span>
                        </button>
                    {/if}
                </div>
            {/each}

            <!-- Add button -->
            <button
                type="button"
                class="add-config-btn"
                on:click={addConfigEntry}
                disabled={isJobRunning}
            >
                <span class="material-icons">add</span>
                Add Step
            </button>

            <button
                on:click={runJob}
                disabled={!uploadedFileId ||
                    !firstEntry?.executionFileName?.trim() ||
                    !firstEntry?.selectedImage ||
                    !firstEntry?.selectedTag ||
                    isJobRunning ||
                    $hasInvalidOrcidEmail}
                class="run-button"
                class:running={isJobRunning}
                title={$hasInvalidOrcidEmail
                    ? "Cannot submit: Your ORCID account has an invalid email address. Please make your email at orcid.org public or contact support."
                    : ""}
            >
                {#if isJobRunning}
                    <div class="md-spinner"></div>
                    Processing...
                {:else}
                    <span class="material-icons">play_arrow</span>
                    Run Replication Workflow
                {/if}
            </button>
            {#if $hasInvalidOrcidEmail}
                <div class="email-warning">
                    <span class="material-icons warning-icon">warning</span>
                    <div class="warning-text">
                        <strong>Action Required:</strong> Your ORCID account
                        does not have a valid public email address. Please
                        update your email:
                        <div class="warning-actions">
                            <button
                                type="button"
                                class="update-email-btn"
                                on:click={() => (showEmailModal = true)}
                            >
                                <span class="material-icons">edit</span>
                                Update Email Here
                            </button>
                            <span class="separator">or</span>
                            <a
                                href="https://orcid.org/my-orcid"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="orcid-link"
                            >
                                <span class="material-icons">open_in_new</span>
                                Make Email Public at ORCiD.org
                            </a>
                            (after changing at ORCiD.org, you will need to relogin)
                        </div>
                    </div>
                </div>
            {/if}
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
<EmailUpdateModal
    bind:show={showEmailModal}
    currentEmail={$user?.email || ""}
/>

<style>
    .job-runner-container {
        margin-bottom: var(--md-spacing-lg);
    }

    .runner-header {
        margin-bottom: var(--md-spacing-md);
    }

    .header-title {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-xs);
    }

    .runner-icon {
        font-size: 1.5rem;
        color: var(--md-primary);
    }

    .runner-header h3 {
        margin: 0;
        color: var(--md-on-surface);
        font-size: 1.25rem;
    }

    .runner-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0;
        padding-left: calc(1.5rem + var(--md-spacing-sm));
    }

    .runner-content {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .config-section {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .config-row {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-md);
        background: var(--md-surface-container-lowest);
    }

    .step-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 28px;
        background: var(--md-primary);
        color: white;
        border-radius: 50%;
        font-size: 0.875rem;
        font-weight: 600;
        flex-shrink: 0;
    }

    .config-widgets {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        gap: var(--md-spacing-sm);
        flex: 1;
        align-items: start;
    }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0; /* Allow shrinking */
    }

    .input-group label {
        font-weight: 500;
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .loading-state {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm);
        background-color: var(--md-surface-variant);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
    }

    .error-state {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm);
        background-color: rgba(244, 67, 54, 0.1);
        color: var(--md-error);
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-caption);
    }

    select {
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%204%205'%3E%3Cpath%20fill='%23666'%20d='M2%200L0%202h4zm0%205L0%203h4z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        padding: var(--md-spacing-sm);
        padding-right: 40px;
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        background-color: var(--md-surface);
        color: var(--md-on-surface);
        font-size: var(--md-font-body2);
        transition: border-color var(--md-transition-standard);
    }

    select:focus {
        outline: none;
        border-color: var(--md-primary);
    }

    select:disabled {
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
    }

    .disabled-select {
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%204%205'%3E%3Cpath%20fill='%23999'%20d='M2%200L0%202h4zm0%205L0%203h4z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        padding: var(--md-spacing-sm);
        padding-right: 40px;
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
        font-size: var(--md-font-body2);
    }

    .file-input {
        padding: var(--md-spacing-sm);
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        background-color: var(--md-surface);
        color: var(--md-on-surface);
        font-size: var(--md-font-body2);
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
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        margin: -12px 0 0 0;
        line-height: 1.2;
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
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-success);
        color: white;
        font-size: var(--md-font-body2);
        font-weight: 500;
        min-height: 44px;
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

    .run-button:focus-visible {
        outline: 3px solid var(--md-success);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(48, 110, 52, 0.3);
    }

    .email-warning {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md);
        background: #fff3cd;
        border: 1px solid #ffc107;
        border-radius: var(--md-radius-xs);
        margin-top: var(--md-spacing-md);
        color: #856404;
    }

    .warning-icon {
        color: #d84315;
        flex-shrink: 0;
    }

    .warning-text {
        font-size: var(--md-font-body2);
        line-height: 1.5;
        flex: 1;
    }

    .warning-text strong {
        display: block;
        margin-bottom: var(--md-spacing-sm);
    }

    .warning-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-top: var(--md-spacing-sm);
    }

    .update-email-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-xs) var(--md-spacing-md);
        background: var(--md-primary);
        color: white;
        border: none;
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-body2);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .update-email-btn:hover {
        background: var(--md-primary-dark);
        box-shadow: var(--md-shadow-sm);
    }

    .update-email-btn:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.3);
    }

    .update-email-btn .material-icons {
        font-size: 18px;
    }

    .separator {
        color: #856404;
        font-weight: 500;
        padding: 0 var(--md-spacing-xs);
    }

    .orcid-link {
        display: inline-flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        color: #0056b3;
        text-decoration: none;
        font-weight: 500;
        padding: var(--md-spacing-xs) var(--md-spacing-sm);
        border-radius: var(--md-radius-xs);
        transition: all 0.2s ease;
    }

    .orcid-link:hover {
        background: rgba(0, 86, 179, 0.1);
        text-decoration: underline;
    }

    .orcid-link:focus-visible {
        outline: 3px solid #0056b3;
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(0, 86, 179, 0.2);
    }

    .orcid-link .material-icons {
        font-size: 18px;
    }

    .add-config-btn {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background: var(--md-secondary-container);
        color: var(--md-on-secondary-container);
        border: none;
        border-radius: var(--md-radius-full);
        font-size: var(--md-font-body2);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        align-self: flex-start;
    }

    .add-config-btn:hover:not(:disabled) {
        background: var(--md-secondary-container);
        box-shadow: var(--md-elevation-1);
        transform: translateY(-1px);
    }

    .add-config-btn:active:not(:disabled) {
        transform: translateY(0);
        box-shadow: none;
    }

    .add-config-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .add-config-btn:focus-visible {
        outline: 3px solid var(--md-secondary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(3, 218, 198, 0.3);
    }

    .remove-config-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: var(--md-error-container);
        color: var(--md-on-error-container);
        border: none;
        border-radius: var(--md-radius-full);
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
    }

    .remove-config-btn:hover:not(:disabled) {
        background: var(--md-error);
        color: var(--md-on-error);
        transform: scale(1.1);
    }

    .remove-config-btn:active:not(:disabled) {
        transform: scale(0.95);
    }

    .remove-config-btn:focus-visible {
        outline: 3px solid var(--md-error);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(244, 67, 54, 0.3);
    }

    .remove-config-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .status-banner {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
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
        font-size: 1.25rem;
        margin-top: 2px;
    }

    .status-content {
        flex: 1;
    }

    .status-message {
        font-weight: 500;
        font-size: var(--md-font-body2);
        line-height: 1.3;
    }

    .job-id {
        font-size: var(--md-font-caption);
        opacity: 0.8;
        font-family: "Courier New", monospace;
        margin-top: 4px;
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
        .header-title {
            flex-direction: row;
        }

        .run-button {
            padding: var(--md-spacing-md);
            font-size: var(--md-font-body2);
        }

        .status-banner {
            flex-direction: column;
            text-align: center;
        }

        .config-widgets {
            grid-template-columns: 1fr;
            gap: var(--md-spacing-sm);
        }

        .config-row {
            flex-direction: column;
            gap: var(--md-spacing-sm);
        }

        .remove-config-btn {
            align-self: center;
            margin-top: var(--md-spacing-sm);
        }
    }
</style>
