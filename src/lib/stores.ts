import { writable, derived } from 'svelte/store';

interface User {
    _id: string;
    login: string;
    email: string;
    [key: string]: any;
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
