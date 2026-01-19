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
}

interface ApiJobStageConfig {
    image_name: string;
    image_tag: string;
    main_file: string;
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

export async function getLatestSubmission(): Promise<Folder | null> {
    const collections = await api('/collection?name=Submissions');
    if (!Array.isArray(collections) || collections.length !== 1) {
        return null;
        //throw new Error('Could not find Submissions collection.');
    }
    const collectionId = collections[0]._id;
    const submissions = await api(`/folder?parentType=collection&parentId=${collectionId}&limit=1&sort=created&sortdir=-1`);
    if (!Array.isArray(submissions) || submissions.length === 0) {
        return null;
    } else {
        return submissions[0];
    }
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
    if (!res.ok && res.status !== 401) { // 401 is handled by checkAuth()
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
export async function submitJob(fileId: string, config: JobStageConfig[]): Promise<any> {
    const endpoint = `/sivacor/submit_job`;

    // translate config object to match expected API format
    // from [{"id": "...", "selectedImage": "...", "selectedTag": "...", "executionFileName":"..."}]
    // to [{"image_name": "...", "image_tag": "...", "main_file":"..."}]
    const transformedConfig: ApiJobStageConfig[] = config.map((stage: JobStageConfig) => ({
        image_name: stage.selectedImage,
        image_tag: stage.selectedTag,
        main_file: stage.executionFileName
    }));

    // Query arguments for the job API
    const queryArgs = new URLSearchParams({
        id: fileId,
        stages: JSON.stringify(transformedConfig)
    });

    const response = await api(`${endpoint}?${queryArgs.toString()}`, {
        method: 'POST',
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
