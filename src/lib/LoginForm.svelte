<script>
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { fetchOAuthProviders } from "./api";

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
            console.error("Failed to load OAuth providers:", e);
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

<div class="login-container md-card md-card-elevated">
    {#if loading}
        <div class="loading-state">
            <div class="md-spinner"></div>
            <p class="loading-text">Loading authentication providers...</p>
        </div>
    {:else if error}
        <div class="error-state">
            <span class="material-icons error-icon">error_outline</span>
            <h3>Authentication Error</h3>
            <p class="error-message">{error}</p>
            <p class="error-description">
                Could not retrieve authentication providers. Please try again
                later.
            </p>
            <button
                on:click={() => window.location.reload()}
                class="md-button-outlined"
            >
                <span class="material-icons">refresh</span>
                Try Again
            </button>
        </div>
    {:else if providers && providers.length > 0}
        <div class="login-content">
            <div class="login-header">
                <span class="material-icons login-icon">login</span>
                <h2>Sign In</h2>
                <p class="login-subtitle">
                    Choose your authentication provider to continue
                </p>
            </div>

            <div class="providers-list">
                {#each providers as provider (provider.id)}
                    <button
                        on:click={() => redirectToProvider(provider.url)}
                        class="provider-button"
                    >
                        <span class="material-icons provider-icon"
                            >account_circle</span
                        >
                        <span class="provider-name">{provider.name}</span>
                        <span class="material-icons provider-arrow"
                            >arrow_forward</span
                        >
                    </button>
                {/each}
            </div>

            <div class="login-footer">
                <p class="security-note">
                    <span class="material-icons">security</span>
                    Your authentication is handled securely by the selected provider
                </p>
            </div>
        </div>
    {:else}
        <div class="empty-state">
            <span class="material-icons empty-icon">warning</span>
            <h3>No Authentication Methods Available</h3>
            <p>
                Please contact your administrator to set up authentication
                providers.
            </p>
        </div>
    {/if}
</div>

<style>
    .login-container {
        max-width: 480px;
        margin: var(--md-spacing-xxl) auto;
        text-align: center;
        animation: slideInUp 0.4s ease-out;
    }

    @keyframes slideInUp {
        from {
            opacity: 0;
            transform: translateY(30px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .loading-state {
        padding: var(--md-spacing-xxl) var(--md-spacing-lg);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--md-spacing-md);
    }

    .loading-text {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        margin: 0;
    }

    .error-state {
        padding: var(--md-spacing-xxl) var(--md-spacing-lg);
    }

    .error-icon {
        font-size: 4rem;
        color: var(--md-error);
        margin-bottom: var(--md-spacing-md);
    }

    .error-state h3 {
        color: var(--md-error);
        margin-bottom: var(--md-spacing-sm);
    }

    .error-message {
        color: var(--md-error);
        font-weight: 500;
        margin-bottom: var(--md-spacing-sm);
    }

    .error-description {
        color: var(--md-on-surface-variant);
        margin-bottom: var(--md-spacing-lg);
    }

    .login-content {
        padding: var(--md-spacing-xl) var(--md-spacing-lg);
    }

    .login-header {
        margin-bottom: var(--md-spacing-xl);
    }

    .login-icon {
        font-size: 4rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-md);
    }

    .login-header h2 {
        margin-bottom: var(--md-spacing-sm);
        color: var(--md-on-surface);
    }

    .login-subtitle {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        margin: 0;
    }

    .providers-list {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
        margin-bottom: var(--md-spacing-xl);
    }

    .provider-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--md-spacing-md) var(--md-spacing-lg);
        background-color: var(--md-surface);
        border: 1px solid var(--md-outline);
        border-radius: var(--md-radius-md);
        color: var(--md-on-surface);
        cursor: pointer;
        transition: all var(--md-transition-standard);
        text-transform: none;
        font-size: var(--md-font-body1);
        font-weight: 500;
        min-height: 56px;
        position: relative;
        overflow: hidden;
    }

    .provider-button:hover {
        background-color: var(--md-primary);
        color: white;
        border-color: var(--md-primary);
        box-shadow: var(--md-elevation-2);
        transform: translateY(-1px);
    }

    .provider-button:active {
        transform: translateY(0);
        box-shadow: var(--md-elevation-1);
    }

    .provider-icon {
        color: var(--md-primary);
        transition: color var(--md-transition-standard);
    }

    .provider-button:hover .provider-icon {
        color: white;
    }

    .provider-name {
        flex: 1;
        text-align: left;
        margin-left: var(--md-spacing-md);
    }

    .provider-arrow {
        color: var(--md-on-surface-variant);
        transition: all var(--md-transition-standard);
    }

    .provider-button:hover .provider-arrow {
        color: white;
        transform: translateX(4px);
    }

    .login-footer {
        border-top: 1px solid var(--md-outline-variant);
        padding-top: var(--md-spacing-lg);
    }

    .security-note {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--md-spacing-xs);
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0;
    }

    .security-note .material-icons {
        font-size: 16px;
        color: var(--md-success);
    }

    .empty-state {
        padding: var(--md-spacing-xxl) var(--md-spacing-lg);
    }

    .empty-icon {
        font-size: 4rem;
        color: var(--md-warning);
        margin-bottom: var(--md-spacing-md);
    }

    .empty-state h3 {
        color: var(--md-on-surface);
        margin-bottom: var(--md-spacing-sm);
    }

    .empty-state p {
        color: var(--md-on-surface-variant);
    }

    @media (max-width: 768px) {
        .login-container {
            margin: var(--md-spacing-lg) auto;
            max-width: none;
        }

        .login-content {
            padding: var(--md-spacing-lg) var(--md-spacing-md);
        }

        .provider-button {
            padding: var(--md-spacing-md);
        }
    }
</style>
