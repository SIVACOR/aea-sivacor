<script>
    import { createEventDispatcher } from "svelte";
    import { initiateFileUpload, uploadFileChunk } from "./api";

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
    let fileInput;
    let selectedFile = null;
    let uploadProgress = 0;
    let isUploading = false;
    let uploadStatus = "";
    let errorMessage = null;

    const dispatch = createEventDispatcher();

    /**
     * Validates if the file type is allowed (zip or tar variants)
     */
    function validateFileType(file) {
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

    function handleFileSelect(event) {
        errorMessage = null;
        const file = event.target.files[0];

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

    function formatFileSize(bytes) {
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
            const { _id: uploadId } = await initiateFileUpload(selectedFile);
            const totalSize = selectedFile.size;

            let offset = 0;
            let uploadedBytes = 0;

            // Step 2: Upload chunks
            let lastChunk = null;
            while (offset < totalSize) {
                const chunk = selectedFile.slice(
                    offset,
                    offset + UPLOAD_CHUNK_SIZE,
                );
                uploadStatus = `Uploading chunk ${Math.ceil(offset / UPLOAD_CHUNK_SIZE) + 1}...`;

                lastChunk = await uploadFileChunk(uploadId, offset, chunk);

                uploadedBytes = offset + chunk.size;
                uploadProgress = Math.floor((uploadedBytes / totalSize) * 100);
                offset += UPLOAD_CHUNK_SIZE;
            }

            // Upload complete, final progress to 100%
            uploadProgress = 100;
            uploadStatus = "Upload complete!";
            console.log("File upload completed successfully:", lastChunk);
            dispatch("uploadcomplete", {
                fileId: lastChunk._id, // This is the ID the JobRunner needs
            });
        } catch (error) {
            console.error("File upload failed:", error);
            errorMessage = "Upload failed. Check console for details.";
            uploadStatus = "Failed";
            uploadProgress = 0; // Reset progress on failure
        } finally {
            isUploading = false;
            // Optionally clear the file input after successful or failed upload
            if (fileInput) fileInput.value = "";
            selectedFile = null;
        }
    }

    function resetUpload() {
        uploadProgress = 0;
        uploadStatus = "";
        errorMessage = null;
        selectedFile = null;
        if (fileInput) fileInput.value = "";
    }
</script>

<div class="upload-widget md-card">
    <div class="upload-header">
        <span class="material-icons upload-icon">cloud_upload</span>
        <h3>File Upload</h3>
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

    <div class="upload-area" class:disabled={isUploading}>
        <input
            type="file"
            bind:this={fileInput}
            on:change={handleFileSelect}
            disabled={isUploading}
            id="file-input"
            class="file-input"
            accept=".zip,.tar,.tar.gz,.tgz,.tar.bz2,.tbz2,.tar.xz,.txz,application/zip,application/x-tar,application/gzip,application/x-gzip"
        />
        <label for="file-input" class="file-input-label">
            <span class="material-icons file-icon">attach_file</span>
            <div class="file-input-text">
                <strong>Choose an archive file</strong> or drag it here
                <small
                    >Supported formats: ZIP, TAR (.zip, .tar.gz, .tgz, etc.) •
                    Max size: 5GB</small
                >
            </div>
        </label>
    </div>

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
            <button on:click={resetUpload} class="md-button-text">
                <span class="material-icons">add</span>
                Upload Another
            </button>
        </div>
    {/if}
</div>

<style>
    .upload-widget {
        margin-bottom: var(--md-spacing-lg);
    }

    .upload-header {
        text-align: center;
        margin-bottom: var(--md-spacing-lg);
    }

    .upload-icon {
        font-size: 3rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-sm);
    }

    .upload-header h3 {
        margin: 0 0 var(--md-spacing-xs) 0;
        color: var(--md-on-surface);
    }

    .upload-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        margin: 0;
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
        padding: var(--md-spacing-xxl) var(--md-spacing-lg);
        border: 2px dashed var(--md-outline);
        border-radius: var(--md-radius-md);
        background-color: var(--md-surface-variant);
        cursor: pointer;
        transition: all var(--md-transition-standard);
        min-height: 120px;
    }

    .file-input-label:hover {
        border-color: var(--md-primary);
        background-color: rgba(25, 118, 210, 0.05);
    }

    .file-icon {
        font-size: 2.5rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-sm);
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
        padding: var(--md-spacing-md);
        background-color: var(--md-surface-variant);
        border-radius: var(--md-radius-sm);
        margin-bottom: var(--md-spacing-lg);
    }

    .file-info {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-md);
        flex: 1;
    }

    .file-type-icon {
        font-size: 2rem;
        color: var(--md-primary);
    }

    .file-details {
        flex: 1;
    }

    .file-name {
        font-weight: 500;
        color: var(--md-on-surface);
        margin-bottom: var(--md-spacing-xs);
        word-break: break-word;
    }

    .file-size {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
    }

    .upload-button {
        gap: var(--md-spacing-xs);
        background-color: var(--md-primary);
        color: white;
        min-width: auto;
    }

    .upload-progress {
        margin-bottom: var(--md-spacing-lg);
    }

    .progress-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: var(--md-spacing-sm);
    }

    .progress-label {
        font-size: var(--md-font-body2);
        color: var(--md-on-surface);
        font-weight: 500;
    }

    .progress-percent {
        font-size: var(--md-font-body2);
        color: var(--md-on-surface-variant);
        font-weight: 500;
    }

    .upload-success {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--md-spacing-md);
        background-color: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
        border-radius: var(--md-radius-sm);
    }

    .success-content {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-md);
    }

    .success-icon {
        font-size: 2rem;
        color: var(--md-success);
    }

    .success-title {
        font-weight: 500;
        color: var(--md-success);
        margin-bottom: var(--md-spacing-xs);
    }

    .success-subtitle {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
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
</style>
