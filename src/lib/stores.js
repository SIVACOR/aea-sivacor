import { writable } from 'svelte/store';

// Represents the user object (or null if unauthenticated)
export const user = writable(null);

// Represents the loading state during the initial authentication check
export const authLoading = writable(true);
