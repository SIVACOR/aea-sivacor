<script>
    import { onMount } from 'svelte';
    import { page } from '$app/stores';
    import { fetchOAuthProviders } from './api';

    /**
     * @typedef {object} OAuthProvider
     * @property {string} id
     * @property {string} name
     * @property {string} url
     */

    /** @type {OAuthProvider[] | null} */
    let providers = null;
    let loading = true;
    let error = null;

    onMount(async () => {
        try {
            // The main page URL is used as the redirect URL.
            // We use $page.url.href to get the full current URL.
            const redirectUrl = $page.url.href; 
            
            providers = await fetchOAuthProviders(redirectUrl);
        } catch (e) {
            console.error('Failed to load OAuth providers:', e);
            error = e.message;
        } finally {
            loading = false;
        }
    });

    /**
     * Handles the button click by redirecting the user to the provider's URL.
     * @param {string} url 
     */
    function redirectToProvider(url) {
        window.location.href = url;
    }

</script>

<div class="login-container">
    {#if loading}
        <p>Loading available login methods...</p>
    {:else if error}
        <p class="error">Error: {error}</p>
        <p>Could not retrieve authentication providers. Please try again later.</p>
    {:else if providers && providers.length > 0}
        <h2>Login with a Provider</h2>
        <div class="button-group">
            {#each providers as provider (provider.id)}
                <button 
                    on:click={() => redirectToProvider(provider.url)}
                    class="provider-button"
                >
                    {provider.name}
                </button>
            {/each}
        </div>
    {:else}
        <p>No login methods are currently available.</p>
    {/if}
</div>

<style>
    .login-container {
        padding: 20px;
        border: 1px solid #ccc;
        border-radius: 8px;
        max-width: 400px;
        margin: 20px auto;
        text-align: center;
    }
    h2 {
        margin-top: 0;
    }
    .button-group {
        display: flex;
        flex-direction: column;
        gap: 10px;
    }
    .provider-button {
        padding: 12px 20px;
        background-color: #3f51b5; /* Example primary color */
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        font-size: 16px;
        transition: background-color 0.2s;
    }
    .provider-button:hover {
        background-color: #303f9f;
    }
    .error {
        color: #d32f2f;
        font-weight: bold;
    }
</style>
