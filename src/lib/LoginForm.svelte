<script lang="ts">
    import { onMount } from "svelte";
    import { page } from "$app/stores";
    import { fetchOAuthProviders } from "./api";
    import { createEventDispatcher } from "svelte";

    const dispatch = createEventDispatcher();

    /**
     * @typedef {object} OAuthProvider
     * @property {string} id
     * @property {string} name
     * @property {string} url
     */

    /** @type {OAuthProvider[] | null} */
    let providers: any[] | null = null;
    let loading = true;
    let error: string | null = null;

    onMount(async () => {
        // Dispatch title update for login state
        dispatch("titleupdate", { title: "SIVACOR - Sign In" });

        try {
            // The main page URL is used as the redirect URL.
            // We use $page.url.href to get the full current URL.
            const redirectUrl = $page.url.href;

            providers = await fetchOAuthProviders(redirectUrl);
        } catch (e) {
            console.error("Failed to load OAuth providers:", e);
            error = e instanceof Error ? e.message : "Unknown error";
            // Dispatch title update for error state
            dispatch("titleupdate", {
                title: "SIVACOR - Authentication Error",
            });
        } finally {
            loading = false;
        }
    });

    /**
     * Handles the button click by redirecting the user to the provider's URL.
     * @param {string} url
     */
    function redirectToProvider(url: string) {
        window.location.href = url;
    }

    /**
     * Gets the documentation base URL by replacing the current domain with docs subdomain
     */
    function getDocsUrl(path: string = "") {
        const currentUrl = new URL($page.url);
        // Replace the current subdomain/domain with docs subdomain
        const docsHost = currentUrl.hostname.replace(/^[^.]*\./, "docs.");
        const docsUrl = `${currentUrl.protocol}//${docsHost}${currentUrl.port ? `:${currentUrl.port}` : ""}${path}`;
        return docsUrl;
    }

    /**
     * Opens documentation in a new tab
     */
    function openDocs(path: string = "") {
        window.open(getDocsUrl(path), "_blank", "noopener,noreferrer");
    }

    /**
     * Refreshes the page to retry loading OAuth providers.
     */
    function retryLoadingProviders() {
        window.location.reload();
    }

    /**
     * Opens email client to send support email.
     */
    function sendSupportEmail() {
        const subject = encodeURIComponent("SIVACOR Authentication Issue");
        const body = encodeURIComponent(
            `Hello SIVACOR Support Team,\n\nI'm experiencing an authentication issue with the SIVACOR application.\n\nError details:\n${error}\n\nPlease assist me with resolving this issue.\n\nThank you,`,
        );
        window.location.href = `mailto:support@sivacor.org?subject=${subject}&body=${body}`;
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
                later or contact our support team for assistance.
            </p>

            <div class="error-actions">
                <button on:click={retryLoadingProviders} class="retry-button">
                    <span class="material-icons">refresh</span>
                    Try Again
                </button>

                <button on:click={sendSupportEmail} class="support-button">
                    <span class="material-icons">mail</span>
                    Contact Support
                </button>
            </div>
        </div>
    {:else if providers && providers.length > 0}
        <div class="login-content">
            <div class="login-header">
                <div class="header-title">
                    <span class="material-icons login-icon">login</span>
                    <h2>Sign In</h2>
                </div>
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
                <div class="docs-links">
                    <button
                        class="docs-link"
                        on:click={() => openDocs()}
                        title="View Documentation"
                    >
                        <span class="material-icons">description</span>
                        <span>Documentation</span>
                    </button>
                    <button
                        class="docs-link"
                        on:click={() => openDocs("/docs/steps/")}
                        title="User Guide"
                    >
                        <span class="material-icons">help</span>
                        <span>User Guide</span>
                    </button>
                </div>

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
        padding: var(--md-spacing-xl) var(--md-spacing-lg);
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--md-spacing-sm);
    }

    .loading-text {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0;
    }

    .error-state {
        padding: var(--md-spacing-xl) var(--md-spacing-lg);
    }

    .error-icon {
        font-size: 3rem;
        color: var(--md-error);
        margin-bottom: var(--md-spacing-sm);
    }

    .error-state h3 {
        color: var(--md-error);
        margin-bottom: var(--md-spacing-xs);
        font-size: 1.25rem;
    }

    .error-message {
        color: var(--md-error);
        font-weight: 500;
        font-size: var(--md-font-body2);
        margin-bottom: var(--md-spacing-xs);
    }

    .error-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        margin-bottom: var(--md-spacing-md);
    }

    .error-actions {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-sm);
        align-items: center;
    }

    .retry-button,
    .support-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border-radius: var(--md-radius-sm);
        font-size: var(--md-font-body2);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--md-transition-standard);
        min-width: 180px;
        justify-content: center;
        text-transform: none;
    }

    .retry-button {
        background-color: var(--md-primary);
        color: white;
        border: none;
    }

    .retry-button:hover {
        background-color: var(--md-primary-dark);
        box-shadow: var(--md-elevation-2);
        transform: translateY(-1px);
    }

    .support-button {
        background-color: transparent;
        color: var(--md-primary);
        border: 2px solid var(--md-primary);
    }

    .support-button:hover {
        background-color: var(--md-primary);
        color: white;
        box-shadow: var(--md-elevation-2);
        transform: translateY(-1px);
    }

    .retry-button:active,
    .support-button:active {
        transform: translateY(0);
        box-shadow: var(--md-elevation-1);
    }

    .retry-button:focus-visible {
        outline: 3px solid var(--md-primary-dark);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.3);
    }

    .support-button:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .login-content {
        padding: var(--md-spacing-lg) var(--md-spacing-md);
    }

    .login-header {
        margin-bottom: var(--md-spacing-md);
    }

    .header-title {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-xs);
    }

    .login-icon {
        font-size: 1.5rem;
        color: var(--md-primary);
    }

    .login-header h2 {
        margin: 0;
        color: var(--md-on-surface);
        font-size: 1.25rem;
    }

    .login-subtitle {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0;
        text-align: center;
    }

    .providers-list {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-lg);
    }

    .provider-button {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-surface);
        border: 1px solid var(--md-outline);
        border-radius: var(--md-radius-md);
        color: var(--md-on-surface);
        cursor: pointer;
        transition: all var(--md-transition-standard);
        text-transform: none;
        font-size: var(--md-font-body2);
        font-weight: 500;
        min-height: 44px;
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

    .provider-button:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
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
        padding-top: var(--md-spacing-md);
    }

    .docs-links {
        display: flex;
        justify-content: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-md);
        flex-wrap: wrap;
    }

    .docs-link {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: transparent;
        border: 1px solid var(--md-outline);
        border-radius: var(--md-radius-sm);
        color: var(--md-primary);
        font-size: var(--md-font-caption);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--md-transition-standard);
        text-transform: none;
        text-decoration: none;
    }

    .docs-link:hover {
        background-color: var(--md-primary);
        color: white;
        border-color: var(--md-primary);
        transform: translateY(-1px);
        box-shadow: var(--md-elevation-1);
    }

    .docs-link:active {
        transform: translateY(0);
        box-shadow: none;
    }

    .docs-link:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .docs-link .material-icons {
        font-size: 16px;
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
        padding: var(--md-spacing-xl) var(--md-spacing-lg);
    }

    .empty-icon {
        font-size: 3rem;
        color: var(--md-warning);
        margin-bottom: var(--md-spacing-sm);
    }

    .empty-state h3 {
        color: var(--md-on-surface);
        margin-bottom: var(--md-spacing-xs);
        font-size: 1.25rem;
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

        .docs-links {
            gap: var(--md-spacing-sm);
        }

        .docs-link {
            padding: var(--md-spacing-xs) var(--md-spacing-sm);
            font-size: 0.75rem;
        }

        .docs-link .material-icons {
            font-size: 14px;
        }

        .error-actions {
            gap: var(--md-spacing-sm);
        }

        .retry-button,
        .support-button {
            min-width: 180px;
            padding: var(--md-spacing-sm) var(--md-spacing-md);
        }
    }
</style>
