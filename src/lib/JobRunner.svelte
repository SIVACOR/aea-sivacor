<script>
    import { submitJob } from './api';
    import FileUploader from './FileUploader.svelte'; // Assuming you refactor FileUploader to emit an ID

    // State for the dropdown
    let selectedOption = 'image1';
    const options = ['image1', 'image2'];

    // State for the file upload (will hold the ID when upload is done)
    /** @type {string | null} */
    let uploadedFileId = null; 

    // State for the job execution
    let isJobRunning = false;
    let jobStatusMessage = '';
    let jobErrorMessage = null;
    let jobId = null;

    /**
     * Placeholder function for the FileUploader completion.
     * In a real implementation, FileUploader must be refactored to call this on success.
     * @param {CustomEvent<{fileId: string}>} event - Event containing the new file ID.
     */
    function handleUploadComplete(event) {
        uploadedFileId = event.detail.fileId;
        jobStatusMessage = `File uploaded! ID: ${uploadedFileId}. Ready to run job.`;
    }

    async function runJob() {
        if (!uploadedFileId) {
            jobErrorMessage = 'Please upload a file first.';
            return;
        }

        isJobRunning = true;
        jobErrorMessage = null;
        jobStatusMessage = `Starting job for option: ${selectedOption}...`;

        try {
            const jobResponse = await submitJob(uploadedFileId, selectedOption);
            jobId = jobResponse.id || 'N/A'; // Assuming the response contains a job ID
            jobStatusMessage = `Job successfully started! Job ID: ${jobId}`;
        } catch (error) {
            console.error('Job submission failed:', error);
            jobErrorMessage = 'Failed to submit job. Check console for details.';
            jobStatusMessage = 'Job submission failed.';
        } finally {
            isJobRunning = false;
        }
    }
</script>

<div class="job-runner-container">
    <h3>Run Processing Job</h3>
    
    <FileUploader on:uploadcomplete={handleUploadComplete} />

    <hr>

    <div class="input-group">
        <label for="option-select">Select Processing Type:</label>
        <select id="option-select" bind:value={selectedOption} disabled={isJobRunning}>
            {#each options as option}
                <option value={option}>{option}</option>
            {/each}
        </select>
    </div>

    <button 
        on:click={runJob} 
        disabled={!uploadedFileId || isJobRunning}
        class:running={isJobRunning}
    >
        {#if isJobRunning}
            Running Job...
        {:else}
            Run Job with {selectedOption}
        {/if}
    </button>
    
    {#if jobStatusMessage}
        <p class="status-message {jobErrorMessage ? 'error' : 'success'}">{jobStatusMessage}</p>
    {/if}
</div>

<style>
    .job-runner-container {
        border: 1px solid #007bff;
        padding: 25px;
        margin-top: 30px;
        border-radius: 8px;
        max-width: 500px;
    }
    .input-group {
        margin: 15px 0;
        display: flex;
        align-items: center;
        gap: 10px;
    }
    label {
        font-weight: bold;
    }
    select {
        padding: 8px;
        border-radius: 4px;
        border: 1px solid #ccc;
    }
    button {
        padding: 10px 20px;
        background-color: #28a745; /* Green for Run */
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        transition: background-color 0.2s;
        margin-top: 10px;
    }
    button:disabled {
        background-color: #ccc;
        cursor: not-allowed;
    }
    button.running {
        background-color: #ffc107; /* Yellow when running */
    }
    .status-message {
        margin-top: 15px;
        padding: 10px;
        border-radius: 4px;
        font-weight: bold;
    }
    .status-message.success {
        background-color: #e6ffed;
        color: #28a745;
    }
    .status-message.error {
        background-color: #ffe6e6;
        color: #d32f2f;
    }
    hr {
        margin: 20px 0;
        border: 0;
        border-top: 1px solid #eee;
    }
</style>
