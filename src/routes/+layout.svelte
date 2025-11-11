<script>
    import { onMount } from 'svelte';
    import { goto } from '$app/navigation';
    import { page } from '$app/stores'; // Import the page store
    import { checkAuthentication, setAuthToken } from '../lib/api';
    import { authLoading } from '../lib/stores';

    onMount(async () => {
        const url = new URL($page.url);
        const tokenFromUrl = url.searchParams.get('girderToken');

        if (tokenFromUrl) {
            // 1. Store the token
            setAuthToken(tokenFromUrl);

            // 2. Remove the token argument from the URL
            url.searchParams.delete('girderToken');
            const newUrl = url.pathname + url.search;

            // 3. Navigate to the cleaned URL without reloading the page
            // Replace the current history entry so the back button works as expected.
            await goto(newUrl, { replaceState: true });
        }

        // Run the authentication check (This uses the newly set token if one was present)
        await checkAuthentication();
        
        // Set loading to false once the check is complete
        authLoading.set(false);
    });
</script>

{#if $authLoading}
    <p>Loading user session...</p>
{:else}
    <slot />
{/if}
