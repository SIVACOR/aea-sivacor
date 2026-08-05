import { get } from 'svelte/store';
import { user } from './stores';
import Cookies from 'js-cookie';
import { env } from '$env/dynamic/public';

// Type definitions
interface OAuthProvider {
    id: string;
    name: string;
    url: string;
}

interface User {
    _id: string;
    login: string;
    email: string;
    [key: string]: any;
}

interface Folder {
    _id: string;
    name: string;
    baseParentType: string;
    baseParentId: string;
    meta?: Record<string, any>;
    [key: string]: any;
}

/**
 * An error thrown by api() for a non-OK response whose body Girder filled in.
 * `details.extra` is Girder's RestException `extra` field -- for the 409 from
 * /sivacor/submit_job it holds the id of the submission already in progress.
 */
export interface ApiError extends Error {
    statusCode?: number;
    details?: {
        message?: string;
        extra?: string;
    };
}

interface JobDetails {
    _id: string;
    status: number;
    created: string;
    log?: string[];
    resultPath?: string;
    [key: string]: any;
}

interface JobStageConfig {
    id: string;
    selectedImage: string;
    selectedTag: string;
    executionFileName: string;
    networkIsolation: boolean;
}

interface ApiJobStageConfig {
    image_name: string;
    image_tag: string;
    main_file: string;
    network_isolation: boolean;
}

/**
 * One workflow stage as it appears in a workflow definition file (and in the
 * submit_job body): the server's vocabulary, not the form's.
 */
export interface WorkflowStage {
    image_name: string;
    image_tag: string;
    main_file: string;
    network_isolation?: boolean;
}

/**
 * A whole workflow definition, i.e. what a user can import from a YAML/JSON
 * file. Shaped by the `stage_schema` served from /sivacor/workflow_schema.
 */
export interface WorkflowDefinition {
    stages: WorkflowStage[];
    env_secrets?: Array<{ key: string; value: string }>;
}

// API Base URL from environment variable with fallback for development
const BASE_URL = env.PUBLIC_SIVACOR_API_URL || 'https://girder.sivacor.org/api/v1';
export const JOB_POLLING_INTERVAL = 5000; // 5 seconds

/**
 * Fetches the list of OAuth providers.
 * @param {string} redirectUrl - The URL to return to after successful authentication.
 * @returns {Promise<Array<{id: string, name: string, url: string}>>} The list of providers.
 */
export async function fetchOAuthProviders(redirectUrl: string): Promise<OAuthProvider[]> {
    const encodedRedirect = encodeURIComponent(redirectUrl);
    const endpoint = `/oauth/provider?redirect=${encodedRedirect}&list=true`;

    // Use the existing api function for the GET request
    const providers = await api(endpoint);

    if (!Array.isArray(providers) || providers.length === 0) {
        throw new Error('No OAuth providers found.');
    }

    return providers;
}

export function getCurrentUser(): User | null {
    // Use get(store) to synchronously read the store's value
    const currentUser = get(user);
    return currentUser;
}

export async function getUploadsFolder() {
    const user = getCurrentUser();
    if (!user || !user._id) {
        throw new Error('User not logged in or user ID not available.');
    }
    const endpoint = `/folder?parentType=user&parentId=${user._id}&name=Uploads&limit=1`;
    const folder = await api(endpoint);
    if (!Array.isArray(folder) || folder.length !== 1) {
        throw new Error('Uploads folder not found for the current user.');
    }
    return folder[0]._id;
}

async function getSubmissionsCollectionId(): Promise<string | null> {
    const collections = await api('/collection?name=Submissions');
    if (!Array.isArray(collections) || collections.length !== 1) {
        return null;
        //throw new Error('Could not find Submissions collection.');
    }
    return collections[0]._id;
}

/**
 * Fetches the current user's most recent submission job.
 *
 * This is the authoritative record of a submission: the job document exists
 * from the moment /sivacor/submit_job returns, whereas the submission folder is
 * only created later, on the worker, by prepare_submission. A submission that
 * is still waiting for a worker therefore has a job but no folder.
 *
 * /job is scoped to the current user by the server, so unlike a folder listing
 * it does not rely on ACLs to keep other users' submissions out.
 *
 * @returns {Promise<JobDetails | null>} The newest submission job, or null.
 */
export async function getLatestSubmissionJob(): Promise<JobDetails | null> {
    const types = encodeURIComponent(JSON.stringify(['sivacor_submission']));
    const jobs = await api(`/job?types=${types}&limit=1&sort=created&sortdir=-1`);
    if (!Array.isArray(jobs) || jobs.length === 0) {
        return null;
    }
    return jobs[0];
}

/**
 * Fetches the submission folder belonging to a given job, if the worker has
 * created it yet.
 * @param {string} jobId - The submission job ID.
 * @returns {Promise<Folder | null>} The submission folder, or null if the
 *   worker has not created it yet.
 */
export async function getSubmissionByJobId(jobId: string): Promise<Folder | null> {
    const collectionId = await getSubmissionsCollectionId();
    if (!collectionId) {
        return null;
    }
    // `jobId` is a SIVACOR-specific filter on Girder's folder listing; it
    // requires parentType/parentId to be given alongside it.
    const submissions = await api(
        `/folder?parentType=collection&parentId=${collectionId}&jobId=${encodeURIComponent(jobId)}`
    );
    if (!Array.isArray(submissions) || submissions.length === 0) {
        return null;
    }
    return submissions[0];
}

/**
 * Fetches a submission by ID or name from the Submissions collection.
 * @param {string} idOrName - The submission folder ID or name.
 * @returns {Promise<Folder | null>} The submission folder object or null if not found.
 */
export async function getSubmissionByIdOrName(idOrName: string): Promise<Folder | null> {
    // First, try to get the Submissions collection
    const collectionId = await getSubmissionsCollectionId();
    if (!collectionId) {
        return null;
    }

    // Try to fetch by ID first (assuming it's a folder ID)
    try {
        const folder = await api(`/folder/${idOrName}`);
        // Verify it's actually in the Submissions collection
        if (folder && folder.baseParentType === 'collection' && folder.baseParentId === collectionId) {
            return folder;
        }
    } catch (error) {
        // If fetching by ID fails, continue to try by name
        console.log('Not a valid folder ID, trying by name...');
    }

    // Try to fetch by name
    const submissions = await api(`/folder?parentType=collection&parentId=${collectionId}&name=${encodeURIComponent(idOrName)}&limit=1`);
    if (Array.isArray(submissions) && submissions.length > 0) {
        return submissions[0];
    }

    return null;
}

/**
 * Deletes a submission folder by ID.
 * @param {string} submissionId - The submission folder ID to delete.
 * @returns {Promise<void>}
 */
export async function deleteSubmission(submissionId: string): Promise<void> {
    if (!submissionId) {
        throw new Error('Submission ID must be provided.');
    }
    await api(`/sivacor/submission/${submissionId}`, {
        method: 'DELETE'
    });
}

export async function deleteItem(itemId: string): Promise<void> {
    if (!itemId) {
        throw new Error("Item ID must be provided");
    }
    await api(`/item/${itemId}`, {
        method: 'DELETE'
    });
}

/**
 * Sets the authentication token in the preferred storage (e.g., as a cookie).
 * @param {string} token - The 'Girder-Token' value.
 */
export function setAuthToken(token: string): void {
    Cookies.set('girderToken', token, { expires: 7, secure: true, sameSite: 'Lax' });
    // localStorage.setItem('girderToken', token); 
}

/**
 * Retrieves the authentication token from either the cookie or localStorage.
 * @returns {string | null} The 'Girder-Token' or null.
 */
export function getGirderToken(): string | null {
    const token = Cookies.get('girderToken') || localStorage.getItem('girderToken');
    return token;
}

/**
 * Given submission folder object, return url to view submission details.
 * @returns {string} URL to a folder in Girder.
 */
export function getSubmissionFolderUrl(folder: Folder): string {
    return `${BASE_URL.replace('/api/v1', '')}/#${folder.baseParentType}/${folder.baseParentId}/folder/${folder._id}`;
}

/**
 * Clears the authentication token from both cookie and localStorage.
 */
export function clearAuthToken() {
    Cookies.remove('girderToken');
    localStorage.removeItem('girderToken');
}

/**
 * Gets the base Girder URL for WebSocket connections.
 * @returns {string} The base Girder URL.
 */
export function getGirderUrl(): string {
    return BASE_URL.replace('/api/v1', '');
}

/**
 * Generic function to make an authenticated API call.
 * @param {string} endpoint - The API path (e.g., '/user/me').
 * @param {object} options - Fetch options.
 * @returns {Promise<any>} The parsed JSON response.
 */
export async function api(endpoint: string, options: RequestInit = {}): Promise<any> {
    const token = getGirderToken();
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> || {})
    };

    if (token) {
        headers['Girder-Token'] = token;
    }

    const res = await fetch(`${BASE_URL}${endpoint}`, {
        ...options,
        headers
    });

    if (res.status === 204) return null; // Handle No Content

    // Check for errors and try to extract detailed error information
    if (!res.ok && res.status !== 401) { // 401 is handled by checkAuth()

        // Try to parse error details from response body
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
            try {
                const errorData = await res.json();
                // If the error response contains a message field, use it
                if (errorData && errorData.message) {
                    const error = new Error(errorData.message) as ApiError;
                    error.statusCode = res.status;
                    error.details = errorData;
                    throw error;
                }
            } catch (parseError) {
                // If parsing fails, fall through to generic error
                if (parseError instanceof Error && parseError.message && !parseError.message.includes('Unexpected')) {
                    throw parseError;
                }
            }
        }

        // Fallback to generic error message
        throw new Error(`API call failed: ${res.statusText}`);
    }

    // Attempt to parse JSON only if content-type is json
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
        return res.json();
    }
    return res; // Return response object for non-json responses (like logout)
}


/**
 * Checks the user's authentication status and updates the user store.
 */
export async function checkAuthentication() {
    try {
        const userData = await api('/user/me');
        user.set(userData); // Will be null or the user object
    } catch (error) {
        console.error('Authentication check failed:', error);
        user.set(null);
    }
}

/**
 * Updates the current user's email address.
 * @param {string} newEmail - The new email address to set.
 * @returns {Promise<User>} The updated user object.
 */
export async function updateUserEmail(newEmail: string): Promise<User> {
    const currentUser = getCurrentUser();
    if (!currentUser || !currentUser._id) {
        throw new Error('User not logged in or user ID not available.');
    }

    // API requires firstName and lastName to be sent along with email as query parameters
    const firstName = currentUser.firstName || currentUser.login || 'User';
    const lastName = currentUser.lastName || '';

    const query = new URLSearchParams({
        email: newEmail,
        firstName: firstName,
        lastName: lastName,
    });

    const endpoint = `/user/${currentUser._id}?${query.toString()}`;
    const response = await api(endpoint, {
        method: 'PUT',
    });

    // Update the user store with the new data
    user.set(response);
    return response;
}

/**
 * Logs out the user.
 */
export async function logout() {
    try {
        // 1. Call the logout API endpoint
        await api('/user/authentication', {
            method: 'DELETE'
        });
    } catch (error) {
        console.error('Logout API call failed:', error);
        // Continue with local cleanup even if API fails
    } finally {
        // 2. Clear the local token storage
        clearAuthToken();
        // 3. Clear the global state
        user.set(null);
        // 4. Navigate to the homepage (optional, but good UX)
        window.location.href = '/';
    }
}

/**
 * Step 1: Initiates a multi-part file upload.
 * @param {File} file - The file object to upload.
 * @returns {Promise<{id: string, name: string}>} The upload object with ID.
 */
export async function initiateFileUpload(file: File): Promise<{ id: string; name: string }> {
    const parentId = await getUploadsFolder(); // Ensure we get the correct Uploads folder ID
    const query = new URLSearchParams({
        parentType: 'folder',
        parentId: parentId,
        name: file.name,
        size: String(file.size),
        mimeType: file.type || 'application/octet-stream'
    });

    // Use the existing api function for the POST request
    const response = await api(`/file?${query.toString()}`, {
        method: 'POST'
    });

    return response;
}

export async function getImages(): Promise<any> {
    const endpoint = '/sivacor/image_tags';
    const response = await api(endpoint);
    return response;
}

/**
 * Fetches the JSON schema a workflow definition must satisfy -- the very schema
 * /sivacor/submit_job validates its body against. Fetched rather than duplicated
 * here so an imported file is checked against the server's current rules.
 * @returns {Promise<Record<string, any>>} The workflow JSON schema.
 */
export async function getWorkflowSchema(): Promise<Record<string, unknown>> {
    return await api('/sivacor/workflow_schema');
}

/**
 * Fetches Girder's public (unauthenticated) settings, which SIVACOR extends
 * with the maintenance-banner settings (`sivacor.banner_enabled`,
 * `sivacor.banner_message`). Works without a valid auth token.
 * @returns {Promise<Record<string, any>>} The public settings map.
 */
export async function getPublicSettings(): Promise<Record<string, any>> {
    return await api('/system/public_settings');
}

/**
 * Step 2: Uploads a single chunk of a file.
 * @param {string} uploadId - The ID returned from initiateFileUpload.
 * @param {number} offset - The starting byte offset of this chunk.
 * @param {Blob} chunk - The chunk of file data.
 */
export async function uploadFileChunk(uploadId: string, offset: number, chunk: Blob): Promise<any> {
    const endpoint = `/file/chunk?offset=${offset}&uploadId=${uploadId}`;
    const response = await api(endpoint, {
        method: 'POST',
        headers: {
            // Must override the default 'application/json' set in api()
            'Content-Type': 'application/octet-stream',
            // Do not send Content-Length, fetch handles this for a Blob/File
        },
        body: chunk
    });
    return response;
}

/**
 * Downloads a file by ID using blob to prevent opening new windows.
 * Ensures all authentication headers are passed properly.
 * @param {string} fileId - The ID of the file to download.
 * @param {string|null} filename - Optional filename for the download. If not provided, will use the fileId.
 * @returns {Promise<void>} Resolves when download is initiated.
 */
export async function downloadFile(fileId: string, filename: string | null = null): Promise<void> {
    if (!fileId) {
        throw new Error("File ID must be provided.");
    }

    const token = getGirderToken();
    const headers: Record<string, string> = {};

    if (token) {
        headers['Girder-Token'] = token;
    }

    try {
        const response = await fetch(`${BASE_URL}/file/${fileId}/download`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`Download failed: ${response.statusText}`);
        }

        // Get the blob from the response
        const blob = await response.blob();

        // Try to get filename from Content-Disposition header if not provided
        let downloadFilename = filename;
        if (!downloadFilename) {
            const contentDisposition = response.headers.get('Content-Disposition');
            if (contentDisposition && contentDisposition.includes('filename=')) {
                const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
                if (filenameMatch && filenameMatch[1]) {
                    downloadFilename = filenameMatch[1].replace(/['"]/g, '');
                }
            }

            // Fallback to fileId if no filename found
            if (!downloadFilename) {
                downloadFilename = fileId;
            }
        }

        // Create blob URL and trigger download
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = downloadFilename;

        // Append to body, click, and remove
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up the blob URL
        window.URL.revokeObjectURL(url);

    } catch (error) {
        console.error('File download failed:', error);
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new Error(`Failed to download file: ${errorMessage}`);
    }
}

/**
 * Submits a new processing job.
 * @param {string} fileId - The ID of the uploaded file.
 * @param {JobStageConfig[]} config - The configuration for the job stages.
 * @returns {Promise<any>} The response object from the job creation endpoint.
 */
export async function submitJob(fileId: string, config: JobStageConfig[], jobSecrets: Record<string, string> = {}): Promise<any> {
    const endpoint = `/sivacor/submit_job`;

    // translate config object to match expected API format
    // from [{"id": "...", "selectedImage": "...", "selectedTag": "...", "executionFileName":"..."}]
    // to [{"image_name": "...", "image_tag": "...", "main_file":"..."}]
    const transformedConfig: ApiJobStageConfig[] = config.map((stage: JobStageConfig) => ({
        image_name: stage.selectedImage,
        image_tag: stage.selectedTag,
        main_file: stage.executionFileName,
        network_isolation: stage.networkIsolation,
    }));

    // Convert map to list of {"name": "...", "value": "..."} objects
    const secretsList = Object.entries(jobSecrets).map(([key, value]) => ({ key, value }));

    // Send file ID as query param (non-sensitive) but stages+secrets in POST body
    const response = await api(`${endpoint}?id=${encodeURIComponent(fileId)}`, {
        method: 'POST',
        body: JSON.stringify({ stages: transformedConfig, env_secrets: secretsList }),
    });

    return response;
}

/**
 * Fetches the details of a specific job.
 * @param {string} jobId - The ID of the job to fetch.
 * @returns {Promise<JobDetails>} The job object.
 */
export async function fetchJobDetails(jobId: string): Promise<JobDetails> {
    if (!jobId) {
        throw new Error("Job ID must be provided.");
    }
    return await api(`/job/${jobId}`);
}

/**
 * Cancels a running job.
 * @param {string} jobId - The ID of the job to cancel.
 * @returns {Promise<any>} The response object from the cancellation endpoint.
 */
export async function cancelJob(jobId: string): Promise<any> {
    if (!jobId) {
        throw new Error("Job ID must be provided.");
    }
    return await api(`/job/${jobId}/cancel`, {
        method: 'PUT'
    });
}

/**
 * Fetches performance metrics for a specific stage from a submission folder.
 * @param {string} folderId - The ID of the submission folder.
 * @param {number} stageNumber - The stage number (1-indexed).
 * @returns {Promise<any>} The performance metrics object.
 */
export async function fetchPerformanceMetrics(folderId: string, stageNumber: number): Promise<any> {
    if (!folderId) {
        throw new Error("Folder ID must be provided.");
    }
    if (stageNumber < 1) {
        throw new Error("Stage number must be 1 or greater.");
    }

    const filename = `performance_data_stage_${stageNumber}.json`;

    try {
        // Get items in the folder
        const items = await api(`/item?folderId=${folderId}&name=${encodeURIComponent(filename)}`);

        if (!Array.isArray(items) || items.length === 0) {
            return null; // Performance file doesn't exist for this stage
        }

        const item = items[0];

        // Download the item content directly
        const token = getGirderToken();
        const headers: Record<string, string> = {};
        if (token) {
            headers['Girder-Token'] = token;
        }

        const response = await fetch(`${BASE_URL}/item/${item._id}/download`, {
            method: 'GET',
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`Failed to download performance metrics: ${response.statusText}`);
        }

        // Read as text first and replace NaN with null before parsing
        const text = await response.text();
        const sanitizedText = text.replace(/:\s*NaN/g, ': null');
        const metricsData = JSON.parse(sanitizedText);
        return metricsData;
    } catch (error) {
        console.error(`Error fetching performance metrics for stage ${stageNumber}:`, error);
        return null;
    }
}
