<script>
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores"; // Import the page store
    import { checkAuthentication, setAuthToken } from "../lib/api";
    import { authLoading } from "../lib/stores";
    import "../app.css";

    onMount(async () => {
        const url = new URL($page.url);
        const tokenFromUrl = url.searchParams.get("girderToken");

        if (tokenFromUrl) {
            // 1. Store the token
            setAuthToken(tokenFromUrl);

            // 2. Remove the token argument from the URL
            url.searchParams.delete("girderToken");
            const newUrl = url.pathname + url.search;

            // 3. Navigate to the cleaned URL without reloading the page
            // Replace the current history entry so the back button works as expected.
            // eslint-disable-next-line svelte/no-navigation-without-resolve
            await goto(newUrl || "/", { replaceState: true });
        }

        // Run the authentication check (This uses the newly set token if one was present)
        await checkAuthentication();

        // Set loading to false once the check is complete
        authLoading.set(false);
    });
</script>

{#if $authLoading}
    <div class="loading-container">
        <div class="loading-content">
            <div class="app-logo">
                <span class="material-icons logo-icon">science</span>
                <h1>SIVACOR</h1>
            </div>
            <div class="loading-spinner-container">
                <div class="md-spinner large"></div>
                <p class="loading-text">Loading user session...</p>
            </div>
            <div class="loading-subtitle">
                <p>Initializing secure authentication</p>
            </div>
        </div>
    </div>
{:else}
    <slot />
{/if}

<style>
    .loading-container {
        display: flex;
        align-items: center;
        justify-content: center;
        min-height: 100vh;
        background: linear-gradient(
            135deg,
            var(--md-primary) 0%,
            var(--md-primary-dark) 100%
        );
        color: white;
        padding: var(--md-spacing-lg);
    }

    .loading-content {
        text-align: center;
        max-width: 400px;
        width: 100%;
    }

    .app-logo {
        margin-bottom: var(--md-spacing-xxl);
    }

    .logo-icon {
        font-size: 4rem;
        color: white;
        margin-bottom: var(--md-spacing-md);
        display: block;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .app-logo h1 {
        font-size: 2.5rem;
        font-weight: 300;
        letter-spacing: 0.1em;
        margin: 0;
        color: white;
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .loading-spinner-container {
        margin: var(--md-spacing-xxl) 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--md-spacing-lg);
    }

    .md-spinner.large {
        width: 48px;
        height: 48px;
        border-width: 3px;
        border-color: rgba(255, 255, 255, 0.3);
        border-top-color: white;
    }

    .loading-text {
        font-size: var(--md-font-body1);
        font-weight: 500;
        color: rgba(255, 255, 255, 0.9);
        margin: 0;
        animation: fadeInOut 2s ease-in-out infinite;
    }

    .loading-subtitle {
        margin-top: var(--md-spacing-lg);
    }

    .loading-subtitle p {
        font-size: var(--md-font-body2);
        color: rgba(255, 255, 255, 0.7);
        margin: 0;
        font-style: italic;
    }

    @keyframes fadeInOut {
        0%,
        100% {
            opacity: 0.7;
        }
        50% {
            opacity: 1;
        }
    }

    @media (max-width: 768px) {
        .loading-container {
            padding: var(--md-spacing-md);
        }

        .app-logo h1 {
            font-size: 2rem;
        }

        .logo-icon {
            font-size: 3rem;
        }

        .md-spinner.large {
            width: 40px;
            height: 40px;
        }
    }
</style>
