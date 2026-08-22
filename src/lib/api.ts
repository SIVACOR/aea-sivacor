import { get } from 'svelte/store';
import { user, type User } from './stores';
import Cookies from 'js-cookie';
import { env } from '$env/dynamic/public';

// Type definitions
export interface OAuthProvider {
    id: string;
    name: string;
    url: string;
}

export interface Folder {
    _id: string;
    name: string;
    baseParentType: string;
    baseParentId: string;
    meta?: Record<string, unknown>;
    [key: string]: unknown;
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

export interface JobDetails {
    _id: string;
    status: number;
    created: string;
    updated?: string;
    log?: string[];
    resultPath?: string;
    /** Girder's failure detail, present once status is ERROR. */
    error?: string;
    [key: string]: unknown;
}

/**
 * The `performance_data_stage_N.json` a run leaves in its submission folder.
 * Every field is optional: the file is assembled from Docker stats, and a run
 * that died early can be missing any of them.
 */
export interface UploadedFile {
    _id: string;
    /** Set on the response to the final chunk, once the item exists. */
    itemId?: string;
    [key: string]: unknown;
}

export interface PerformanceMetrics {
    StartedAt?: string;
    FinishedAt?: string;
    MaxCPUPercent?: number;
    MaxMemoryUsage?: number;
    NCPU?: number;
    MemTotal?: number;
    OperatingSystem?: string;
    /**
     * The container's own run arguments, as a JSON *string* -- the backend dumps
     * `container_kwargs` verbatim (lib.py), and this is the field the TRO
     * certifies as DockerRunArgs. `mem_limit` inside it is the cap the analysis
     * was actually given; see containerMemoryLimit.
     */
    DockerRunArgs?: string;
    /** The rung the submission asked for. Absent on runs from before P1. */
    RequestedMemoryGB?: number | null;
    /**
     * Peak *workspace* bytes for this stage -- the extracted package as it grew,
     * not the analysis image that had to be on the machine first. The backend
     * keeps the two apart deliberately (lib.py): a Stata image alone is several
     * GiB, so a sum would make every Stata run look like a storage hog.
     */
    MaxDiskUsage?: number;
    [key: string]: unknown;
}

/**
 * The memory cap one stage's container was given, in bytes.
 *
 * Read out of `DockerRunArgs` rather than from a field of its own, which is a
 * deliberate deviation from the plan's "add mem_limit_bytes to
 * PerformanceMetrics": the file has no such field, the number is already inside
 * DockerRunArgs on every run since 2026-08-12, and adding a second copy would
 * put two spellings of one figure into a file that gets hashed into a signed
 * TRO. Parsing it also means the hint works for submissions that already exist,
 * which a new backend field could not.
 *
 * Absent when Docker reported no MemTotal, in which case the analysis really was
 * uncapped and there is no fraction to show.
 */
export function containerMemoryLimit(metrics: PerformanceMetrics): number | null {
    if (typeof metrics?.DockerRunArgs !== 'string') {
        return null;
    }
    try {
        const limit = JSON.parse(metrics.DockerRunArgs)?.mem_limit;
        return typeof limit === 'number' && Number.isFinite(limit) && limit > 0 ? limit : null;
    } catch {
        return null;
    }
}

/**
 * What the previous submission actually came to, as the resource controls'
 * evidence (S5 guard 1, and C4 reuses it for disk). Best-effort by
 * construction: submissions are deleted after the retention window, so this is
 * often simply absent.
 *
 * Every field is independently nullable and the type is named for peaks rather
 * than for memory, because the two measurements do not arrive together:
 * `MaxDiskUsage` is written on every run, while the memory figures come from a
 * Docker stats CSV that a run can die before producing. A run with disk and no
 * memory is therefore an ordinary state, and each hint renders on its own.
 */
export interface PreviousRunPeaks {
    /** The highest memory peak across the run's stages -- one submission, one machine. */
    peakBytes: number | null;
    /** The memory cap that run was given, when it can be recovered. */
    limitBytes: number | null;
    /** The highest peak *workspace* across the run's stages. */
    peakDiskBytes: number | null;
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
 * Workflow-level resources, i.e. the machine the whole submission runs on.
 * Workflow-level and not per-stage because every stage of one submission runs
 * on one worker; a per-stage figure would be a promise the platform cannot
 * keep.
 */
export interface WorkflowResources {
    memory_gb?: number;
    /**
     * Extra scratch disk, in whole GB, for the workspace this submission grows.
     *
     * **Absent means no volume**, which is every submission by default and is
     * deliberately distinct from 0: the absent case takes a server path with no
     * Cinder call in it at all (V1). So this field is omitted, never sent as
     * null or zero, when nothing was asked for.
     */
    disk_gb?: number;
}

/**
 * A whole workflow definition, i.e. what a user can import from a YAML/JSON
 * file. Shaped by the `stage_schema` served from /sivacor/workflow_schema.
 */
export interface WorkflowDefinition {
    stages: WorkflowStage[];
    env_secrets?: Array<{ key: string; value: string }>;
    resources?: WorkflowResources;
}

/**
 * One rung of the worker-size catalogue, as GET /sivacor/worker_sizes reports
 * it. `memory_gb` is the advertised RAM figure, and it is also the value that
 * travels in an exported workflow file -- the class *is* the number, so there
 * is deliberately no cloud flavour name here to leak into a user's YAML.
 *
 * `gated` and `selectable` say different things and both are needed: `gated`
 * is a property of the catalogue (this rung is by request), `selectable` is the
 * answer for whoever asked. A rung can be gated and selectable at once, for a
 * member of the group that may have it.
 */
export interface WorkerSize {
    memory_gb: number;
    vcpus: number;
    gated: boolean;
    selectable: boolean;
}

export interface WorkerSizeCatalogue {
    sizes: WorkerSize[];
    /** What a submission gets when it asks for nothing: the smallest ungated rung. */
    default: number | null;
}

/**
 * The caller's own scratch-volume allowance, as GET /sivacor/volume_quota
 * reports it.
 *
 * Three separate numbers because the server refuses for three separate reasons
 * and they read very differently to a researcher: `enabled` false is *not
 * offered here*, `max_gb` 0 is *not approved yet* (the default for every
 * account, so an ordinary answer rather than an error), and a `deployment_gb`
 * smaller than what was asked for is a *capacity* problem the researcher can do
 * nothing about. Collapsing them would send an approved user to ask for access
 * they already have.
 *
 * `granularity_gb` matters to the client, not just to the operator: the server
 * rounds a request *up* to a multiple of it **before** checking it against
 * `max_gb`, so a client that does not round the same way can offer a value it
 * will then be refused for.
 */
export interface VolumeQuota {
    enabled: boolean;
    max_gb: number;
    granularity_gb: number;
    deployment_gb: number;
}

/**
 * What a request of `gb` would actually be granted, in GB.
 *
 * Rounds *up*, like the server, so the researcher never gets less than they
 * asked for -- and so a request is checked against the ceiling as the figure it
 * will become, not as the one that was typed. Doing this the other way round is
 * how 199 GB gets accepted against a 195 GB ceiling and then granted 200.
 */
export function grantedVolumeGb(quota: VolumeQuota, gb: number): number {
    const step = quota.granularity_gb > 0 ? quota.granularity_gb : 1;
    return Math.ceil(gb / step) * step;
}

/**
 * The largest request this caller could actually have granted, or 0 for none.
 *
 * The *minimum* of their own ceiling and the deployment's reservation, because
 * submit_job checks both independently and either can refuse. Offering the
 * larger of the two would put a value in the control that the server rejects.
 */
export function volumeCeilingGb(quota: VolumeQuota | null): number {
    if (!quota || !quota.enabled) return 0;
    return Math.max(0, Math.min(quota.max_gb, quota.deployment_gb));
}

/**
 * Why a disk request cannot be honoured, in the researcher's words, or null when
 * it can be.
 *
 * One implementation for the form's pre-submit guard and the importer's file
 * check, deliberately: they are the same four refusals, and two copies of them
 * would eventually disagree in front of the same user. Each message mirrors the
 * server's own (rest.resolve_volume_gb) rather than paraphrasing it, so being
 * refused here and being refused there read the same.
 *
 * Returns null when `quota` is null -- an unknown quota is not a refusal. This
 * build can meet a Girder that predates the endpoint, and in that case the
 * server is the only thing that can rule on the request.
 */
export function volumeRefusal(quota: VolumeQuota | null, gb: number | null): string | null {
    if (gb === null || quota === null) return null;
    if (!Number.isInteger(gb) || gb <= 0) {
        return 'Extra scratch disk must be a whole number of gigabytes, or left empty for none.';
    }
    if (!quota.enabled) {
        return 'Extra scratch disk is not available on this deployment.';
    }
    if (quota.max_gb <= 0) {
        return 'Extra scratch disk needs approval. Contact support@sivacor.org to request it.';
    }
    const granted = grantedVolumeGb(quota, gb);
    if (granted > quota.max_gb) {
        return (
            `${gb} GB of extra scratch disk is more than your ${quota.max_gb} GB ` +
            `limit. Ask for ${quota.max_gb} GB or less, or contact ` +
            'support@sivacor.org to raise it.'
        );
    }
    if (granted > quota.deployment_gb) {
        // A capacity message, not a permissions one: this user *is* approved for
        // the size they asked for and the deployment is what cannot supply it,
        // so telling them to request access would send them to ask for
        // something they already have.
        return (
            `${gb} GB of extra scratch disk is more than this deployment currently ` +
            `has available (${quota.deployment_gb} GB). Contact support@sivacor.org.`
        );
    }
    return null;
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
    const providers = await api<OAuthProvider[]>(endpoint);

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

/** Cached so the settings fetch happens once, not on every upload. */
let uploadsFolderNamePromise: Promise<string> | null = null;

/**
 * The name of the per-user uploads folder, per the backend's
 * `sivacor.uploads_folder_name` setting.
 *
 * The backend creates *and* looks up the folder under this name, so hardcoding
 * "Uploads" here would break every upload the moment an admin changed it.
 * Falls back to "Uploads" -- the setting's own default -- when the settings
 * call fails or the key is absent, which is also what folders created before
 * the setting went live are named.
 */
async function getUploadsFolderName(): Promise<string> {
    if (!uploadsFolderNamePromise) {
        uploadsFolderNamePromise = getPublicSettings()
            .then((settings) => {
                const name = settings?.['sivacor.uploads_folder_name'];
                return typeof name === 'string' && name ? name : 'Uploads';
            })
            .catch(() => 'Uploads');
    }
    return uploadsFolderNamePromise;
}

export async function getUploadsFolder() {
    const user = getCurrentUser();
    if (!user || !user._id) {
        throw new Error('User not logged in or user ID not available.');
    }
    const name = await getUploadsFolderName();
    const endpoint =
        `/folder?parentType=user&parentId=${user._id}` +
        `&name=${encodeURIComponent(name)}&limit=1`;
    const folder = await api<Folder[]>(endpoint);
    if (!Array.isArray(folder) || folder.length !== 1) {
        throw new Error(`${name} folder not found for the current user.`);
    }
    return folder[0]._id;
}

async function getSubmissionsCollectionId(): Promise<string | null> {
    const collections = await api<Folder[]>('/collection?name=Submissions');
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
    const jobs = await api<JobDetails[]>(`/job?types=${types}&limit=1&sort=created&sortdir=-1`);
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
    const submissions = await api<Folder[]>(
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
        const folder = await api<Folder>(`/folder/${idOrName}`);
        // Verify it's actually in the Submissions collection
        if (folder && folder.baseParentType === 'collection' && folder.baseParentId === collectionId) {
            return folder;
        }
    } catch {
        // If fetching by ID fails, continue to try by name
        console.log('Not a valid folder ID, trying by name...');
    }

    // Try to fetch by name
    const submissions = await api<Folder[]>(`/folder?parentType=collection&parentId=${collectionId}&name=${encodeURIComponent(idOrName)}&limit=1`);
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
 * An archive sitting in the user's Uploads folder that no submission has claimed.
 */
export interface PendingUpload {
    itemId: string;
    /** null when the item does not hold exactly one file, i.e. cannot be submitted as-is. */
    fileId: string | null;
    name: string;
    size: number;
    created: string;
}

/**
 * Lists uploads that are still sitting in the user's Uploads folder.
 *
 * An upload lands in the user's own Uploads folder and stays there -- counting
 * against their storage quota -- until the worker's prepare_submission step
 * *moves* the item into the admin-owned Submissions collection. That move is
 * what transfers the bytes off the user's quota, so anything still in Uploads
 * has no live submission behind it: either the user never pressed Run, or the
 * submission died before the worker claimed the item. Nothing on the server
 * ever cleans these up, so without this listing they are invisible and
 * permanent.
 *
 * @returns {Promise<PendingUpload[]>} Unclaimed uploads, newest first.
 */
export async function listPendingUploads(): Promise<PendingUpload[]> {
    let folderId: string;
    try {
        folderId = await getUploadsFolder();
    } catch {
        // The Uploads folder is only created for users registered after the
        // plugin was installed; if there is none, nothing can be pending.
        return [];
    }

    const items = await api<Array<{ _id: string; name: string; size?: number; created?: string }>>(
        `/item?folderId=${folderId}&limit=100&sort=created&sortdir=-1`
    );
    if (!Array.isArray(items) || items.length === 0) {
        return [];
    }

    // submitJob() takes a *file* id, but a folder lists *items*, so each
    // candidate needs its file resolved before it can be offered for reuse.
    return Promise.all(
        items.map(async (item) => {
            let fileId: string | null = null;
            try {
                const files = await api<Array<{ _id: string }>>(`/item/${item._id}/files?limit=2`);
                // One file per item is the shape the uploader produces. Anything
                // else cannot be handed to submit_job unambiguously, so it is
                // listed for deletion only.
                if (Array.isArray(files) && files.length === 1) {
                    fileId = files[0]._id;
                }
            } catch {
                fileId = null;
            }
            return {
                itemId: item._id,
                fileId,
                name: item.name,
                size: item.size ?? 0,
                created: item.created ?? ''
            };
        })
    );
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
 * Absolute URL of the image allow-list endpoint -- the same list that fills the
 * runner's image and tag dropdowns. Quotable in exported files as the
 * authoritative source of valid image_name/image_tag values.
 * @returns {string} URL of /sivacor/image_tags on this deployment.
 */
export function getImageTagsUrl(): string {
    return `${BASE_URL}/sivacor/image_tags`;
}

/**
 * Generic function to make an authenticated API call.
 *
 * The response shape is whatever the caller declares: `api<Folder[]>(...)`.
 * There is no runtime check, so the type parameter is a claim about the
 * endpoint, not a guarantee -- but it keeps that claim in one visible place
 * instead of spreading `any` through every caller.
 *
 * @param {string} endpoint - The API path (e.g., '/user/me').
 * @param {object} options - Fetch options.
 * @returns {Promise<T>} The parsed JSON response.
 */
export async function api<T = unknown>(endpoint: string, options: RequestInit = {}): Promise<T> {
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

    if (res.status === 204) return null as T; // Handle No Content

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
    // Non-JSON responses (logout, for one) hand back the raw Response. No
    // caller reads it today, so the cast documents the quirk rather than
    // forcing every call site to allow for it.
    return res as unknown as T;
}


/**
 * Checks the user's authentication status and updates the user store.
 */
export async function checkAuthentication() {
    try {
        const userData = await api<User | null>('/user/me');
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
    const response = await api<User>(endpoint, {
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
export async function initiateFileUpload(file: File): Promise<{ id?: string; _id?: string; name: string }> {
    const parentId = await getUploadsFolder(); // Ensure we get the correct Uploads folder ID
    const query = new URLSearchParams({
        parentType: 'folder',
        parentId: parentId,
        name: file.name,
        size: String(file.size),
        mimeType: file.type || 'application/octet-stream'
    });

    // Use the existing api function for the POST request
    const response = await api<{ id?: string; _id?: string; name: string }>(`/file?${query.toString()}`, {
        method: 'POST'
    });

    return response;
}

export async function getImages(): Promise<Record<string, string[]>> {
    const endpoint = '/sivacor/image_tags';
    const response = await api<Record<string, string[]>>(endpoint);
    return response;
}

/**
 * Fetches the JSON schema a workflow definition must satisfy -- the very schema
 * /sivacor/submit_job validates its body against. Fetched rather than duplicated
 * here so an imported file is checked against the server's current rules.
 * @returns {Promise<Record<string, any>>} The workflow JSON schema.
 */
export async function getWorkflowSchema(): Promise<Record<string, unknown>> {
    return await api<Record<string, unknown>>('/sivacor/workflow_schema');
}

/**
 * Fetches the worker sizes this user may ask for.
 *
 * `selectable` is filled in client-side when the server does not send it: the
 * UI and the API are separate deployments, so this build can meet a Girder that
 * predates the group gate. Falling back to `!gated` reproduces that server's
 * actual behaviour exactly -- it refuses every gated rung to everyone -- rather
 * than offering a rung it would then reject.
 * @returns {Promise<WorkerSizeCatalogue>} The catalogue, plus the default size.
 */
export async function getWorkerSizes(): Promise<WorkerSizeCatalogue> {
    const response = await api<WorkerSizeCatalogue>('/sivacor/worker_sizes');
    return {
        default: response?.default ?? null,
        sizes: (response?.sizes ?? []).map((size) => ({
            ...size,
            selectable: size.selectable ?? !size.gated,
        })),
    };
}

/**
 * Fetches the caller's own scratch-volume allowance, or null when this Girder
 * cannot say.
 *
 * Null rather than a thrown error, and null rather than a zeroed quota: the UI
 * and the API are separate deployments, so this build can meet a Girder that
 * predates the endpoint entirely. A zeroed quota would render the control as
 * *not approved*, which advertises a feature that server has never heard of;
 * null renders no control at all, which is exactly what the form did before C4.
 *
 * Every field is defaulted, because a partial answer from a newer or older
 * server must not produce `NaN` in an input's `max`.
 * @returns {Promise<VolumeQuota | null>} The allowance, or null if unavailable.
 */
export async function getVolumeQuota(): Promise<VolumeQuota | null> {
    try {
        const response = await api<VolumeQuota>('/sivacor/volume_quota');
        if (!response) return null;
        return {
            enabled: response.enabled === true,
            max_gb: Number(response.max_gb) || 0,
            // Falling back to 1 GB, i.e. no rounding, rather than to a guess: a
            // client that rounds to a step the server does not use would refuse
            // values the server would have accepted.
            granularity_gb: Number(response.granularity_gb) || 1,
            deployment_gb: Number(response.deployment_gb) || 0,
        };
    } catch (error) {
        console.warn('Could not load the scratch-volume quota:', error);
        return null;
    }
}

/**
 * Fetches Girder's public (unauthenticated) settings, which SIVACOR extends
 * with the maintenance-banner settings (`sivacor.banner_enabled`,
 * `sivacor.banner_message`). Works without a valid auth token.
 * @returns {Promise<Record<string, any>>} The public settings map.
 */
export async function getPublicSettings(): Promise<Record<string, unknown>> {
    return await api<Record<string, unknown>>('/system/public_settings');
}

/**
 * Step 2: Uploads a single chunk of a file.
 * @param {string} uploadId - The ID returned from initiateFileUpload.
 * @param {number} offset - The starting byte offset of this chunk.
 * @param {Blob} chunk - The chunk of file data.
 */
export async function uploadFileChunk(uploadId: string, offset: number, chunk: Blob): Promise<UploadedFile> {
    const endpoint = `/file/chunk?offset=${offset}&uploadId=${uploadId}`;
    const response = await api<UploadedFile>(endpoint, {
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
 * Builds a directly-linkable download URL for a file.
 *
 * Deliberately a plain URL rather than a fetch: handing the browser the link
 * lets it stream the file straight to disk, show it in its own download UI the
 * moment the request starts, and offer cancel/resume. Fetching into a Blob
 * instead buffers the whole replication package in the tab and leaves the user
 * staring at a dead button until it finishes.
 *
 * Auth travels as `?token=` because a link carries no headers. Girder reads
 * that parameter (its cookie fallback is no use here -- ours is set on the app's
 * origin, not the API's), and /file/:id/download is one of the endpoints
 * explicitly marked as safe to authenticate this way.
 *
 * @param {string} fileId - The ID of the file to download.
 * @returns {string} An absolute URL that downloads the file when navigated to.
 */
export function getFileDownloadUrl(fileId: string): string {
    if (!fileId) {
        throw new Error("File ID must be provided.");
    }

    const url = `${BASE_URL}/file/${fileId}/download`;
    const token = getGirderToken();
    return token ? `${url}?token=${encodeURIComponent(token)}` : url;
}

/**
 * Submits a new processing job.
 * @param {string} fileId - The ID of the uploaded file.
 * @param {JobStageConfig[]} config - The configuration for the job stages.
 * @param {Record<string, string>} jobSecrets - Environment secrets for every stage.
 * @param {number | null} memoryGb - The worker size to ask for, or null to take
 *   the server's default. Omitted from the body entirely when null: the schema
 *   types memory_gb as an integer, so a null would be rejected, and "absent"
 *   is what every submission sent before there was anything to pick.
 * @param {number | null} diskGb - Extra scratch disk in GB, or null for none.
 *   Omitted when null for a stronger reason than memory's: on the server,
 *   absent is the only value that takes a path with no Cinder call in it, so
 *   sending 0 or null here would turn "no volume" into a refusal (V1).
 * @returns {Promise<any>} The response object from the job creation endpoint.
 */
export async function submitJob(fileId: string, config: JobStageConfig[], jobSecrets: Record<string, string> = {}, memoryGb: number | null = null, diskGb: number | null = null): Promise<JobDetails> {
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

    // One `resources` object holding whichever halves were asked for, and the
    // key itself absent when neither was: the two fields are independent -- a
    // submission can name a size and no disk, or disk and no size -- so this
    // cannot be two spread expressions, the second of which would overwrite the
    // first's `resources`.
    const resources: WorkflowResources = {
        ...(memoryGb === null ? {} : { memory_gb: memoryGb }),
        ...(diskGb === null ? {} : { disk_gb: diskGb }),
    };

    // Send file ID as query param (non-sensitive) but stages+secrets in POST body
    const response = await api<JobDetails>(`${endpoint}?id=${encodeURIComponent(fileId)}`, {
        method: 'POST',
        body: JSON.stringify({
            stages: transformedConfig,
            env_secrets: secretsList,
            ...(Object.keys(resources).length === 0 ? {} : { resources }),
        }),
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
    return await api<JobDetails>(`/job/${jobId}`);
}

/**
 * Cancels a running job.
 * @param {string} jobId - The ID of the job to cancel.
 * @returns {Promise<any>} The response object from the cancellation endpoint.
 */
export async function cancelJob(jobId: string): Promise<JobDetails> {
    if (!jobId) {
        throw new Error("Job ID must be provided.");
    }
    return await api<JobDetails>(`/job/${jobId}/cancel`, {
        method: 'PUT'
    });
}

/**
 * Fetches performance metrics for a specific stage from a submission folder.
 * @param {string} folderId - The ID of the submission folder.
 * @param {number} stageNumber - The stage number (1-indexed).
 * @returns {Promise<any>} The performance metrics object.
 */
export async function fetchPerformanceMetrics(folderId: string, stageNumber: number): Promise<PerformanceMetrics | null> {
    if (!folderId) {
        throw new Error("Folder ID must be provided.");
    }
    if (stageNumber < 1) {
        throw new Error("Stage number must be 1 or greater.");
    }

    const filename = `performance_data_stage_${stageNumber}.json`;

    try {
        // Get items in the folder
        const items = await api<Array<{ _id: string }>>(`/item?folderId=${folderId}&name=${encodeURIComponent(filename)}`);

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
