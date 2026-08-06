<script lang="ts">
    import { onMount } from "svelte";
    import { goto } from "$app/navigation";
    import { page } from "$app/stores"; // Import the page store
    import {
        checkAuthentication,
        setAuthToken,
        getPublicSettings,
    } from "../lib/api";
    import { authLoading } from "../lib/stores";
    import Banner from "../lib/Banner.svelte";
    import CookieNotice from "../lib/CookieNotice.svelte";
    import "../app.css";
    import { browser } from "$app/environment";

    // Maintenance banner. Content is driven by backend settings
    // (`sivacor.banner_enabled` / `sivacor.banner_message`) exposed via
    // Girder's public settings endpoint, so it can be changed/removed without
    // rebuilding and redeploying the frontend.
    let showBanner = false;
    let bannerMessage = "";

    let showCookieNotice = false;
    if (browser) {
        showCookieNotice =
            sessionStorage.getItem("cookieNoticeDismissed") !== "true";
    }

    function dismissCookieNotice() {
        showCookieNotice = false;
        sessionStorage.setItem("cookieNoticeDismissed", "true");
    }

    /**
     * Loads the maintenance banner content from the backend and decides
     * whether to show it. Dismissal is keyed on the message text so that a new
     * message re-appears even if a previous one was dismissed this session.
     */
    async function loadBanner() {
        try {
            const settings = await getPublicSettings();
            const enabled = settings?.["sivacor.banner_enabled"] === true;
            const message = settings?.["sivacor.banner_message"];
            bannerMessage = typeof message === "string" ? message : "";

            if (browser && enabled && bannerMessage) {
                showBanner =
                    sessionStorage.getItem("bannerDismissed") !== bannerMessage;
            } else {
                showBanner = false;
            }
        } catch (error) {
            console.error("Failed to load banner settings:", error);
            showBanner = false;
        }
    }

    function dismissBanner() {
        showBanner = false;
        sessionStorage.setItem("bannerDismissed", bannerMessage);
    }

    // The placeholder-ORCID-email warning that used to live here (a disabled
    // alert() plus its own copy of the detection regex) has been superseded by
    // the `hasInvalidOrcidEmail` store and EmailUpdateModal, which JobRunner
    // shows inline. See ORCID_EMAIL_WARNING.md; the old version is in git.

    onMount(async () => {
        // Load the maintenance banner (independent of auth).
        loadBanner();

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

<svelte:head>
    <title>SIVACOR - Loading</title>
</svelte:head>

{#if $authLoading}
    <div class="loading-container">
        <div class="loading-content">
            <div class="app-logo">
                <img
                    src="/sivacor_logo_notext_trans.png"
                    alt="SIVACOR logo"
                    class="logo-icon"
                />
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
    <div class="page-wrapper">
        {#if showBanner}
            <Banner message={bannerMessage} on:dismiss={dismissBanner} />
        {/if}
        <slot />
        <footer class="app-footer">
            <a href="/privacy">Privacy Policy</a>
        </footer>
    </div>
    {#if showCookieNotice}
        <CookieNotice on:dismiss={dismissCookieNotice} />
    {/if}
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
        width: 64px;
        height: 64px;
        margin-bottom: var(--md-spacing-md);
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

    .page-wrapper {
        display: flex;
        flex-direction: column;
        min-height: 100dvh;
    }

    .app-footer {
        text-align: center;
        padding: var(--md-spacing-md) var(--md-spacing-lg);
        border-top: 1px solid var(--md-outline);
        background: var(--md-surface);
        font-size: 0.8rem;
    }

    .app-footer a {
        color: var(--md-on-surface-variant);
        text-decoration: none;
    }

    .app-footer a:hover {
        color: var(--md-primary);
        text-decoration: underline;
    }

    @media (max-width: 768px) {
        .loading-container {
            padding: var(--md-spacing-md);
        }

        .app-logo h1 {
            font-size: 2rem;
        }

        .logo-icon {
            width: 48px;
            height: 48px;
        }

        .md-spinner.large {
            width: 40px;
            height: 40px;
        }
    }
</style>
