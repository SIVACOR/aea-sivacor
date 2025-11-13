<script>
    import { createEventDispatcher } from "svelte";
    import { initiateFileUpload, uploadFileChunk } from "./api";

    const UPLOAD_CHUNK_SIZE = 1024 * 1024 * 5;

    // State variables
    let fileInput;
    let selectedFile = null;
    let uploadProgress = 0;
    let isUploading = false;
    let uploadStatus = "";
    let errorMessage = null;

    const dispatch = createEventDispatcher();

    function handleFileSelect(event) {
        errorMessage = null;
        selectedFile = event.target.files[0];
        uploadProgress = 0;
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
</script>

<div class="upload-widget">
    <h3>File Upload Widget</h3>

    {#if errorMessage}
        <p class="error-message">Error: {errorMessage}</p>
    {/if}

    <input
        type="file"
        bind:this={fileInput}
        on:change={handleFileSelect}
        disabled={isUploading}
    />

    {#if selectedFile && !isUploading}
        <p>
            Selected: **{selectedFile.name}** ({Math.round(
                selectedFile.size / 1024,
            )} KB)
        </p>
        <button on:click={startUpload} disabled={isUploading}>
            Start Upload
        </button>
    {:else if isUploading || uploadProgress > 0}
        <div class="progress-container">
            <div class="progress-bar" style="width: {uploadProgress}%;"></div>
            <span class="progress-text">{uploadProgress}% - {uploadStatus}</span
            >
        </div>
    {:else if uploadProgress === 100}
        <p class="success-message">File uploaded successfully!</p>
        <button
            on:click={() => {
                uploadProgress = 0;
                uploadStatus = "";
            }}
        >
            Upload Another
        </button>
    {/if}
</div>

<style>
    .upload-widget {
        border: 1px solid #ddd;
        padding: 20px;
        margin-top: 20px;
        border-radius: 8px;
        max-width: 500px;
    }
    .progress-container {
        width: 100%;
        background-color: #f3f3f3;
        border-radius: 5px;
        margin-top: 10px;
        position: relative;
        height: 25px;
    }
    .progress-bar {
        height: 100%;
        background-color: #4caf50;
        border-radius: 5px;
        text-align: right;
        transition: width 0.3s ease;
    }
    .progress-text {
        position: absolute;
        width: 100%;
        top: 50%;
        left: 0;
        transform: translateY(-50%);
        text-align: center;
        color: #333;
        font-weight: bold;
        font-size: 14px;
    }
    .error-message {
        color: #d32f2f;
        font-weight: bold;
    }
    .success-message {
        color: #4caf50;
        font-weight: bold;
    }
    button {
        margin-top: 10px;
        padding: 8px 15px;
        background-color: #007bff;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
    }
    button:disabled {
        background-color: #ccc;
        cursor: not-allowed;
    }
</style>
