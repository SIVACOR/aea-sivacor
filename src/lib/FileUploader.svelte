<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { deleteItem, initiateFileUpload, uploadFileChunk } from "./api";

    const UPLOAD_CHUNK_SIZE = 1024 * 1024 * 5;

    // Allowed file types and extensions
    const ALLOWED_EXTENSIONS = [
        ".zip",
        ".tar",
        ".tar.gz",
        ".tgz",
        ".tar.bz2",
        ".tbz2",
        ".tar.xz",
        ".txz",
    ];
    const ALLOWED_MIME_TYPES = [
        "application/zip",
        "application/x-zip-compressed",
        "application/x-tar",
        "application/x-gtar",
        "application/gzip",
        "application/x-gzip",
        "application/x-compressed-tar",
        "application/x-bzip2",
        "application/x-xz",
    ];

    // State variables
    let fileInput: HTMLInputElement;
    let selectedFile: File | null = null;
    let uploadProgress = 0;
    let isUploading = false;
    let isDragging = false;
    let uploadStatus = "";
    let errorMessage: string | null = null;
    let uploadedItemId: string | null = null;
    let isDeletingUpload = false;

    const dispatch = createEventDispatcher();

    /**
     * Validates if the file type is allowed (zip or tar variants)
     */
    function validateFileType(file: File | null): boolean {
        if (!file) return false;

        const fileName = file.name.toLowerCase();
        const fileType = file.type;

        // Check by file extension
        const hasValidExtension = ALLOWED_EXTENSIONS.some((ext) =>
            fileName.endsWith(ext),
        );

        // Check by MIME type
        const hasValidMimeType = ALLOWED_MIME_TYPES.includes(fileType);

        return hasValidExtension || hasValidMimeType;
    }

    function handleFileSelect(event: Event) {
        const target = event.target as HTMLInputElement;
        if (!target || !target.files) return;
        const file = target.files[0];

        if (!file) {
            selectedFile = null;
            uploadProgress = 0;
            return;
        }

        // Validate file type
        if (!validateFileType(file)) {
            errorMessage = `Invalid file type. Please select a ZIP or TAR archive (.zip, .tar, .tar.gz, .tgz, .tar.bz2, .tbz2, .tar.xz, .txz)`;
            selectedFile = null;
            // Clear the file input
            if (fileInput) fileInput.value = "";
            return;
        }

        selectedFile = file;
        uploadProgress = 0;
    }

    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        isDragging = true;
    }

    function handleDragLeave() {
        isDragging = false;
    }

    function handleDrop(event: DragEvent) {
        event.preventDefault();
        isDragging = false;

        if (isUploading) return; // Prevent drops during active uploads

        if (event.dataTransfer && event.dataTransfer.files.length > 0) {
            const file = event.dataTransfer.files[0];

            // Reuse your existing validation logic!
            if (!validateFileType(file)) {
                errorMessage = `Invalid file type. Please select a ZIP or TAR archive (.zip, .tar, .tar.gz, .tgz, .tar.bz2, .tbz2, .tar.xz, .txz)`;
                selectedFile = null;
                if (fileInput) fileInput.value = "";
                return;
            }

            selectedFile = file;
            uploadProgress = 0;
        }
    }

    function formatFileSize(bytes: number): string {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    }

    /**
     * Uploads the file in chunks.
     */
    async function startUpload() {
        if (!selectedFile) {
            errorMessage = "Please select a file first.";
            return;
        }

        isUploading = true;
        uploadStatus = "Initiating upload...";
        errorMessage = null;

        try {
            // Step 1: Initiate the upload
            const uploadResponse = await initiateFileUpload(selectedFile);
            const uploadId = uploadResponse.id || (uploadResponse as any)._id;
            const totalSize = selectedFile.size;
            const totalSizeMB = Math.round(totalSize / (1024 * 1024));

            let offset = 0;
            let uploadedBytes = 0;

            // Step 2: Upload chunks
            let lastChunk = null;
            while (offset < totalSize) {
                const chunk = selectedFile.slice(
                    offset,
                    offset + UPLOAD_CHUNK_SIZE,
                );

                const uploadedMB = Math.round(uploadedBytes / (1024 * 1024));
                uploadStatus = `Uploading ${uploadedMB} of ${totalSizeMB} MB...`;

                lastChunk = await uploadFileChunk(uploadId, offset, chunk);

                uploadedBytes = offset + chunk.size;
                uploadProgress = Math.floor((uploadedBytes / totalSize) * 100);
                offset += UPLOAD_CHUNK_SIZE;
            }

            // Upload complete, final progress to 100%
            uploadProgress = 100;
            uploadStatus = "Upload complete!";
            console.log("File upload completed successfully:", lastChunk);
            uploadedItemId = lastChunk.itemId;
            dispatch("uploadcomplete", {
                fileId: lastChunk._id, // This is the ID the JobRunner needs
            });
        } catch (error) {
            console.error("File upload failed:", error);
            // Extract detailed error message if available
            if (error instanceof Error) {
                errorMessage = error.message;
            } else {
                errorMessage = "Upload failed. Check console for details.";
            }
            uploadStatus = "Failed";
            uploadProgress = 0; // Reset progress on failure
        } finally {
            isUploading = false;
            // Optionally clear the file input after successful or failed upload
            if (fileInput) fileInput.value = "";
            selectedFile = null;
        }
    }

    async function handleDelete() {
        if (!uploadedItemId) {
            resetUpload();
            return;
        }
        isDeletingUpload = true;
        try {
            await deleteItem(uploadedItemId);
        } catch (error) {
            console.error("Failed to delete item:", error);
            isDeletingUpload = false;
        }
        resetUpload();
    }

    function resetUpload() {
        uploadProgress = 0;
        uploadStatus = "";
        errorMessage = null;
        selectedFile = null;
        if (fileInput) fileInput.value = "";
        uploadedItemId = null;
        isDeletingUpload = false;
    }
</script>

<div class="upload-widget md-card">
    <div class="upload-header">
        <div class="header-title">
            <span class="material-icons upload-icon">cloud_upload</span>
            <h3>File Upload</h3>
        </div>
        <p class="upload-description">
            Select a ZIP or TAR archive for processing
        </p>
    </div>

    {#if errorMessage}
        <div class="error-banner">
            <span class="material-icons">error</span>
            <span>{errorMessage}</span>
        </div>
    {/if}

    {#if !(uploadProgress === 100 && !isUploading)}
        <div
            class="upload-area"
            class:disabled={isUploading}
            class:is-dragging={isDragging}
            on:dragover={handleDragOver}
            on:dragenter={handleDragOver}
            on:dragleave={handleDragLeave}
            on:drop={handleDrop}
            role="region"
            aria-label="File upload drop zone"
            aria-describedby="upload-instructions"
        >
            <label for="file-input" class="file-input-label">
                <span class="material-icons file-icon" aria-hidden="true"
                    >attach_file</span
                >
                <div class="file-input-text">
                    <strong>Choose an archive file</strong> or drag it here
                    <small id="upload-instructions"
                        >Supported formats: ZIP, TAR (.zip, .tar.gz, .tgz, etc.)
                        • Max size: 5GB</small
                    >
                </div>
            </label>
            <input
                type="file"
                bind:this={fileInput}
                on:change={handleFileSelect}
                disabled={isUploading}
                id="file-input"
                class="file-input"
                aria-label="Choose an archive file to upload"
                accept=".zip,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tar.xz,.txz,application/zip,application/x-tar,application/gzip,application/x-gzip"
            />
        </div>
        <!-- Live region to announce drag state changes to assistive technologies -->
        <div class="sr-only" aria-live="polite" aria-atomic="true">
            {isDragging ? "File detected. Release to upload." : ""}
        </div>
    {/if}

    {#if selectedFile && !isUploading}
        <div class="file-preview">
            <div class="file-info">
                <span class="material-icons file-type-icon">description</span>
                <div class="file-details">
                    <div class="file-name">{selectedFile.name}</div>
                    <div class="file-size">
                        {formatFileSize(selectedFile.size)}
                    </div>
                </div>
            </div>
            <button on:click={startUpload} class="upload-button">
                <span class="material-icons">cloud_upload</span>
                Start Upload
            </button>
        </div>
    {/if}

    {#if isUploading || uploadProgress > 0}
        <div class="upload-progress">
            <div class="progress-header">
                <span class="progress-label">{uploadStatus}</span>
                <span class="progress-percent">{uploadProgress}%</span>
            </div>
            <div class="md-progress">
                <div
                    class="md-progress-bar"
                    style="width: {uploadProgress}%"
                ></div>
            </div>
        </div>
    {/if}

    {#if uploadProgress === 100 && !isUploading}
        <div class="upload-success">
            <div class="success-content">
                <span class="material-icons success-icon">check_circle</span>
                <div>
                    <div class="success-title">Upload Successful!</div>
                    <div class="success-subtitle">
                        Your file is ready for processing
                    </div>
                </div>
            </div>
            <button
                on:click={handleDelete}
                disabled={isDeletingUpload}
                class="delete-and-reset-button"
            >
                <span class="material-icons">delete</span>
                Delete Uploaded File
            </button>
        </div>
    {/if}
</div>

<style>
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

    .upload-widget {
        margin-bottom: var(--md-spacing-lg);
    }

    .upload-header {
        margin-bottom: var(--md-spacing-md);
    }

    .header-title {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-xs);
    }

    .upload-icon {
        font-size: 1.5rem;
        color: var(--md-primary);
    }

    .upload-header h3 {
        margin: 0;
        color: var(--md-on-surface);
        font-size: 1.25rem;
    }

    .upload-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0;
        padding-left: calc(1.5rem + var(--md-spacing-sm));
    }

    .error-banner {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md);
        background-color: rgba(244, 67, 54, 0.1);
        color: var(--md-error);
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: var(--md-radius-xs);
        margin-bottom: var(--md-spacing-lg);
        font-size: var(--md-font-body2);
        font-weight: 500;
    }

    .upload-area {
        position: relative;
        margin-bottom: var(--md-spacing-lg);
    }

    .upload-area.disabled {
        opacity: 0.6;
        pointer-events: none;
    }

    .file-input {
        position: absolute;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }

    .file-input-label {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--md-spacing-lg) var(--md-spacing-md);
        border: 2px dashed var(--md-outline);
        border-radius: var(--md-radius-md);
        background-color: var(--md-surface-variant);
        cursor: pointer;
        transition: all var(--md-transition-standard);
        min-height: 80px;
    }

    .file-input-label:hover {
        border-color: var(--md-primary);
        background-color: rgba(25, 118, 210, 0.05);
    }

    .upload-area:focus-within .file-input-label {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        border-color: var(--md-primary);
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .upload-area.is-dragging .file-input-label {
        border-color: var(--md-primary);
        background-color: rgba(25, 118, 210, 0.1);
        transform: scale(1.02); /* Slight pop effect */
        transition: all var(--md-transition-standard);
    }

    .file-icon {
        font-size: 1.75rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-xs);
    }

    .file-input-text {
        text-align: center;
    }

    .file-input-text strong {
        display: block;
        color: var(--md-on-surface);
        font-size: var(--md-font-body1);
        margin-bottom: var(--md-spacing-xs);
    }

    .file-input-text small {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
    }

    .file-preview {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-surface-variant);
        border-radius: var(--md-radius-sm);
        margin-bottom: var(--md-spacing-md);
    }

    .file-info {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        flex: 1;
    }

    .file-type-icon {
        font-size: 1.5rem;
        color: var(--md-primary);
    }

    .file-details {
        flex: 1;
    }

    .file-name {
        font-weight: 500;
        color: var(--md-on-surface);
        font-size: var(--md-font-body2);
        word-break: break-word;
        line-height: 1.3;
    }

    .file-size {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        margin-top: 2px;
    }

    .upload-button {
        gap: var(--md-spacing-xs);
        background-color: var(--md-primary);
        color: white;
        min-width: auto;
    }

    .upload-button:focus-visible {
        outline: 3px solid var(--md-primary-dark);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.3);
    }

    .upload-progress {
        margin-bottom: var(--md-spacing-md);
    }

    .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--md-spacing-xs);
    }

    .progress-label {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface);
        font-weight: 500;
    }

    .progress-percent {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        font-weight: 500;
    }

    .upload-success {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
        border-radius: var(--md-radius-sm);
    }

    .success-content {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
    }

    .success-icon {
        font-size: 1.5rem;
        color: var(--md-success);
    }

    .success-title {
        font-weight: 500;
        color: var(--md-success);
        font-size: var(--md-font-body2);
        line-height: 1.3;
    }

    .success-subtitle {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        margin-top: 2px;
    }

    @media (max-width: 768px) {
        .file-preview,
        .upload-success {
            flex-direction: column;
            gap: var(--md-spacing-md);
            text-align: center;
        }

        .upload-button {
            width: 100%;
        }
    }

    /* Visually hidden but accessible to screen readers */
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
</style>
