import { user } from './stores';
import Cookies from 'js-cookie'; // You'll need to install 'js-cookie' (npm install js-cookie)

// Replace with your actual base URL
const BASE_URL = 'https://girder.local.xarthisius.xyz';

/**
 * Fetches the list of OAuth providers.
 * @param {string} redirectUrl - The URL to return to after successful authentication.
 * @returns {Promise<Array<{id: string, name: string, url: string}>>} The list of providers.
 */
export async function fetchOAuthProviders(redirectUrl) {
    const encodedRedirect = encodeURIComponent(redirectUrl);
    const endpoint = `/api/v1/oauth/provider?redirect=${encodedRedirect}&list=true`;
    
    // Use the existing api function for the GET request
    const providers = await api(endpoint);

    if (!Array.isArray(providers) || providers.length === 0) {
        throw new Error('No OAuth providers found.');
    }
    
    return providers;
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
 * @param {string} endpoint - The API path (e.g., '/api/v1/user/me').
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
        const userData = await api('/api/v1/user/me');
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
        await api('/api/v1/user/authentication', {
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
