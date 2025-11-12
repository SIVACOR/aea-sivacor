<script>
    import { onMount, onDestroy } from 'svelte';
    import { get } from 'svelte/store';
    import { user } from './stores'; // Assuming user store is updated with full user model
    import { fetchJobDetails, cancelJob, JOB_POLLING_INTERVAL, submitJob } from './api';
    import JobRunner from './JobRunner.svelte';

    // Job Status mapping
    const STATUS = {
        0: 'INACTIVE',
        1: 'QUEUED',
        2: 'RUNNING',
        3: 'SUCCESS',
        4: 'ERROR',
        5: 'CANCELED'
    };
    
    // State
    let isMonitoring = false;
    let jobDetails = null;
    let jobStatusText = null;
    let errorMessage = null;
    let pollIntervalId = null;

    $: lastJobId = $user ? $user.lastJobId : null;
    $: lastProjectId = $user ? $user.lastProjectId : null;
    $: showRunner = !isMonitoring && !lastJobId;
    
    // Reactive check for polling state
    $: isJobActive = jobDetails && (
        jobDetails.status === 0 || // INACTIVE
        jobDetails.status === 1 || // QUEUED
        jobDetails.status === 2    // RUNNING
    );

    /**
     * Polling function to check job status.
     */
    async function checkJobStatus(jobId) {
        try {
            const details = await fetchJobDetails(jobId);
            jobDetails = details;
            jobStatusText = STATUS[details.status] || 'UNKNOWN';
            
            // If the job is finished (SUCCESS, ERROR, CANCELED), stop polling
            if (!isJobActive) {
                stopPolling();
            }

            // Handle specific status changes
            if (details.status === 4) { // ERROR
                errorMessage = details.error || 'The job encountered an unspecified error.';
            }

        } catch (e) {
            console.error('Error fetching job details:', e);
            errorMessage = 'Could not fetch job status.';
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
        
        jobStatusText = 'Canceling...';
        
        try {
            await cancelJob(jobDetails._id);
            // Wait for the next poll to confirm CANCELED status from backend
        } catch (e) {
            console.error('Job cancellation failed:', e);
            jobStatusText = 'Cancellation failed.';
        }
    }
    
    /**
     * Clears the last job and resets the UI to show the runner form.
     * In a real app, this would likely involve an API call to clear lastJobId on the user model.
     */
    function resetJob() {
        stopPolling();
        jobDetails = null;
        jobStatusText = null;
        errorMessage = null;
        // Mocking the user store update to clear lastJobId
        user.update(u => ({ ...u, lastJobId: null }));
    }

    // Lifecycle hook to start monitoring if lastJobId exists when the component mounts
    onMount(() => {
        if (lastJobId) {
            startPolling(lastJobId);
        }
    });

    // Cleanup hook to stop polling when the component is destroyed
    onDestroy(stopPolling);

    // Watch for changes in lastJobId (e.g., when JobRunner submits a new job)
    $: if (lastJobId && !isMonitoring) {
        startPolling(lastJobId);
    }

    // Function to handle successful job submission from JobRunner
    function handleJobSubmitted(event) {
        const newJobId = event.detail.jobId;
        // Mock updating the user store with the new job ID
        user.update(u => ({ ...u, lastJobId: newJobId }));
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
            <p><strong>Status:</strong> 
                <span class="status-badge status-{jobDetails.status}">
                    {jobStatusText}
                </span>
            </p>

            {#if isJobActive}
                <div class="polling-info">
                    <p>Status is actively updating <span class="dot"></span></p>
                    <button on:click={handleCancel} disabled={jobDetails.status === 5 || jobStatusText === 'Canceling...'}>
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
                        <a href="{jobDetails.resultPath}" target="_blank">View Result</a>
                    {/if}
                    <button on:click={resetJob} class="reset-button">Run New Job</button>
                </div>
            {:else if jobDetails.status === 4}
                <!-- ERROR -->
                <div class="result-message error">
                    <h3>❌ Job Failed!</h3>
                    <p>{errorMessage || 'An error occurred during job execution.'}</p>
                    <pre>{jobDetails.log || 'No error log available.'}</pre>
                    <button on:click={resetJob} class="reset-button">Run New Job</button>
                </div>
            {:else if jobDetails.status === 5}
                <!-- CANCELED -->
                <div class="result-message cancelled">
                    <h3>🛑 Job Canceled</h3>
                    <p>The job was manually canceled.</p>
                    <button on:click={resetJob} class="reset-button">Run New Job</button>
                </div>
            {/if}
        </div>
    {:else}
        <p>Checking user status for previous jobs...</p>
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
    .status-0, .status-1, .status-2 { background-color: #ffc107; color: #333; } /* INACTIVE, QUEUED, RUNNING (Yellow/Orange) */
    .status-3 { background-color: #28a745; } /* SUCCESS (Green) */
    .status-4 { background-color: #dc3545; } /* ERROR (Red) */
    .status-5 { background-color: #6c757d; } /* CANCELED (Grey) */

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
        0% { opacity: 0.5; }
        50% { opacity: 1; }
        100% { opacity: 0.5; }
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
</style>
