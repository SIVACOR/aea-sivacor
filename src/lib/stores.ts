import { writable, derived } from 'svelte/store';

/**
 * A Girder user. The named fields are the ones this app reads; the index
 * signature keeps the rest of Girder's document accessible without pretending
 * we know its type. Exported so api.ts shares this definition rather than
 * keeping a second copy in sync.
 */
export interface User {
    _id: string;
    login: string;
    email: string;
    firstName?: string;
    lastName?: string;
    [key: string]: unknown;
}

// Represents the user object (or null if unauthenticated)
export const user = writable<User | null>(null);

// Represents the loading state during the initial authentication check
export const authLoading = writable<boolean>(true);

// Derived store to check if user has invalid ORCID email
export const hasInvalidOrcidEmail = derived(user, ($user) => {
    if (!$user || !$user.email) return false;
    return /^\d{4}.*@orcid\.org$/.test($user.email);
});
