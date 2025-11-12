import { get } from 'svelte/store';
import { user } from './stores';
import Cookies from 'js-cookie'; // You'll need to install 'js-cookie' (npm install js-cookie)

// Replace with your actual base URL
const BASE_URL = 'https://girder.local.xarthisius.xyz/api/v1';

/**
 * Fetches the list of OAuth providers.
 * @param {string} redirectUrl - The URL to return to after successful authentication.
 * @returns {Promise<Array<{id: string, name: string, url: string}>>} The list of providers.
 */
export async function fetchOAuthProviders(redirectUrl) {
    const encodedRedirect = encodeURIComponent(redirectUrl);
    const endpoint = `/oauth/provider?redirect=${encodedRedirect}&list=true`;
    
    // Use the existing api function for the GET request
    const providers = await api(endpoint);

    if (!Array.isArray(providers) || providers.length === 0) {
        throw new Error('No OAuth providers found.');
    }
    
    return providers;
}

export function getCurrentUser() {
    // Use get(store) to synchronously read the store's value
    const currentUser = get(user);
    return currentUser;
}

export async function getUploadsFolder() {
    const user = getCurrentUser();
    const endpoint = `/folder?parentType=user&parentId=${user._id}&name=Uploads&limit=1`;
    const folder = await api(endpoint);
    if (!Array.isArray(folder) || folder.length !== 1) {
        throw new Error('Uploads folder not found for the current user.');
    }
    return folder[0]._id;
}

/**
 * Sets the authentication token in the preferred storage (e.g., as a cookie).
 * @param {string} token - The 'Girder-Token' value.
 */
export function setAuthToken(token) {
    // You can choose to store it as a cookie or in localStorage.
    // Storing as a Cookie is generally preferred for authentication tokens
    // as it's automatically sent with requests, and can be configured with 'HttpOnly'.
    // For this client-side example, we'll use a client-readable cookie.
    Cookies.set('girderToken', token, { expires: 7, secure: true, sameSite: 'Lax' });
    // If you prefer localStorage:
    // localStorage.setItem('girderToken', token); 
}

/**
 * Retrieves the authentication token from either the cookie or localStorage.
 * @returns {string | null} The 'Girder-Token' or null.
 */
function getAuthToken() {
    const token = Cookies.get('girderToken') || localStorage.getItem('girderToken');
    return token;
}

/**
 * Clears the authentication token from both cookie and localStorage.
 */
export function clearAuthToken() {
    Cookies.remove('girderToken');
    localStorage.removeItem('girderToken');
}

/**
 * Generic function to make an authenticated API call.
 * @param {string} endpoint - The API path (e.g., '/user/me').
 * @param {object} options - Fetch options.
 * @returns {Promise<any>} The parsed JSON response.
 */
export async function api(endpoint, options = {}) {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers
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
 * @param {string} parentType - The type of the parent object (e.g., 'folder').
 * @param {string} parentId - The ID of the parent object.
 * @returns {Promise<{id: string, name: string}>} The upload object with ID.
 */
export async function initiateFileUpload(file) {
    const parentId = await getUploadsFolder(); // Ensure we get the correct Uploads folder ID
    const query = new URLSearchParams({
        parentType: 'folder',
        parentId: parentId,
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream'
    });

    // Use the existing api function for the POST request
    const response = await api(`/file?${query.toString()}`, {
        method: 'POST'
    });

    return response;
}

/**
 * Step 2: Uploads a single chunk of a file.
 * @param {string} uploadId - The ID returned from initiateFileUpload.
 * @param {number} offset - The starting byte offset of this chunk.
 * @param {Blob} chunk - The chunk of file data.
 */
export async function uploadFileChunk(uploadId, offset, chunk) {
    const endpoint = `/file/chunk?offset=${offset}&uploadId=${uploadId}`;

    await api(endpoint, {
        method: 'POST',
        headers: {
            // Must override the default 'application/json' set in api()
            'Content-Type': 'application/octet-stream',
            // Do not send Content-Length, fetch handles this for a Blob/File
        },
        body: chunk
    });
}

/**
 * Submits a new processing job.
 * @param {string} fileId - The ID of the uploaded file.
 * @param {string} dropdownValue - The selected value from the dropdown ('image1' or 'image2').
 * @returns {Promise<any>} The response object from the job creation endpoint.
 */
export async function submitJob(fileId, dropdownValue) {
    const endpoint = `/job`;

    // Query arguments for the job API
    const queryArgs = new URLSearchParams({
        fileId: fileId,
        processingType: dropdownValue // Using a descriptive name for the qarg
    });

    // The request body (often required even if using qargs, depending on API design)
    const body = {
        // You might add other static parameters here if required by the API
    };

    const response = await api(`${endpoint}?${queryArgs.toString()}`, {
        method: 'POST',
        body: JSON.stringify(body)
    });

    return response;
}
