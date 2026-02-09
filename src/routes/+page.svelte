<script lang="ts">
    import { user } from "../lib/stores";
    import { logout } from "../lib/api";
    import LoginForm from "../lib/LoginForm.svelte";
    import JobMonitor from "../lib/JobMonitor.svelte";
    import { page } from "$app/stores";

    // A reactive statement to determine if the user is logged in
    $: isAuthenticated = $user !== null;

    // State for tracking current job and submission status
    let currentJobState: {
        status: string;
        isRunning: boolean;
        hasError: boolean;
    } | null = null;
    let isJobRunning = false;
    let jobStatusText: string | null = null;

    // Reactive title based on authentication and job state
    $: browserTitle = (() => {
        if (!isAuthenticated) {
            return "SIVACOR - Sign In Required";
        }

        if (isJobRunning && jobStatusText) {
            if (
                jobStatusText.includes("Progress") ||
                jobStatusText.includes("Starting")
            ) {
                return "SIVACOR - Submission in Progress";
            }
            return `SIVACOR - ${jobStatusText}`;
        }

        if (currentJobState && currentJobState.status) {
            const status = currentJobState.status;
            switch (status) {
                case "INACTIVE":
                    return "SIVACOR - Job Inactive";
                case "QUEUED":
                    return "SIVACOR - Job Queued";
                case "RUNNING":
                    return "SIVACOR - Job Running";
                case "SUCCESS":
                    return "SIVACOR - Job Completed Successfully";
                case "ERROR":
                    return "SIVACOR - Job Failed";
                case "CANCELED":
                    return "SIVACOR - Job Canceled";
                default:
                    return `SIVACOR - ${status}`;
            }
        }

        return "SIVACOR - Dashboard";
    })();

    /**
     * Handle job state updates from JobMonitor component
     */
    function handleJobStateUpdate(event: any) {
        const { status, isRunning, hasError } = event.detail;
        currentJobState = {
            status: status,
            isRunning: isRunning,
            hasError: hasError,
        };
        isJobRunning = isRunning;
        if (status) {
            jobStatusText = status;
        }
    }

    /**
     * Handle job submission events from JobRunner/JobMonitor
     */
    function handleJobSubmitted(event: any) {
        const { status } = event.detail;
        isJobRunning = true;
        jobStatusText = status || "Submission in Progress";
    }

    /**
     * Handle title updates from LoginForm component
     */
    function handleLoginTitleUpdate(event: any) {
        const { title } = event.detail;
        console.log("LoginForm title update:", title);
        // The LoginForm can override the reactive title temporarily
        // but the reactive browserTitle will take precedence once state changes
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
     * Opens email client to send general support email.
     */
    function sendSupportEmail() {
        const subject = encodeURIComponent("SIVACOR Support Request");
        const body = encodeURIComponent(
            `Hello SIVACOR Support Team,\n\nI have a question/need assistance with the SIVACOR application.\n\nUser: ${$user ? `${($user as any).firstName} ${($user as any).lastName}` : "Anonymous"}\n\nDescription of my question/issue:\n[Please describe your question or issue here]\n\nThank you for your assistance,`,
        );
        window.location.href = `mailto:support@sivacor.org?subject=${subject}&body=${body}`;
    }

    /**
     * Gets the feedback URL by replacing the current domain with feedback subdomain
     */
    function getFeedbackUrl() {
        const currentUrl = new URL($page.url);
        const feedbackHost = currentUrl.hostname.replace(
            /^[^.]*\./,
            "feedback.",
        );
        const feedbackUrl = `${currentUrl.protocol}//${feedbackHost}${currentUrl.port ? `:${currentUrl.port}` : ""}/`;
        return feedbackUrl;
    }
</script>

<svelte:head>
    <title>{browserTitle}</title>
</svelte:head>

<div class="app-container">
    <header class="app-header md-card">
        <div class="header-content">
            <div class="header-top">
                <h1 class="app-title">
                    <img
                        src="/sivacor_logo_notext_trans.png"
                        alt="SIVACOR logo"
                        class="logo-icon-small"
                    />
                    SIVACOR
                </h1>
                <nav class="header-nav">
                    <button
                        class="nav-link"
                        on:click={() => openDocs()}
                        title="View Documentation"
                    >
                        <span class="material-icons">description</span>
                        <span>Docs</span>
                    </button>
                    <button
                        class="nav-link"
                        on:click={() => openDocs("/docs/steps/")}
                        title="FAQ"
                    >
                        <span class="material-icons">help</span>
                        <span>Guide</span>
                    </button>
                </nav>
            </div>

            <p class="app-subtitle">
                Scalable Infrastructure for Validation of Computational Social
                Science Research
            </p>

            {#if isAuthenticated}
                <div class="user-info">
                    <div class="user-details">
                        <span class="material-icons user-icon"
                            >account_circle</span
                        >
                        <span class="user-name"
                            >Hello, {($user as any)?.firstName}
                            {($user as any)?.lastName}</span
                        >
                    </div>
                    <button
                        on:click={logout}
                        class="md-button-outlined logout-btn"
                    >
                        <span class="material-icons">logout</span>
                        Logout
                    </button>
                </div>
            {/if}
        </div>
    </header>

    <main class="main-content">
        {#if isAuthenticated}
            <JobMonitor
                on:jobstateupdate={handleJobStateUpdate}
                on:jobsubmitted={handleJobSubmitted}
                on:jobreset={handleJobStateUpdate}
            />

            <div class="support-section md-card">
                <div class="support-header">
                    <span class="material-icons support-icon">help_center</span>
                    <h3>Need Help?</h3>
                    <p class="support-description">
                        Have questions about using SIVACOR? Need technical
                        assistance? We're here to help!
                    </p>
                </div>

                <div class="support-actions">
                    <button
                        on:click={() => openDocs()}
                        class="support-button secondary"
                    >
                        <span class="material-icons">description</span>
                        User Guide
                    </button>

                    <button
                        on:click={sendSupportEmail}
                        class="support-button primary"
                    >
                        <span class="material-icons">mail</span>
                        Contact Support
                    </button>

                    <a
                        href={getFeedbackUrl()}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="support-button secondary"
                    >
                        <span class="material-icons">feedback</span>
                        Send Feedback
                    </a>
                </div>

                <div class="support-info">
                    <div class="support-item">
                        <span class="material-icons">email</span>
                        <span>support@sivacor.org</span>
                    </div>
                    <div class="support-item">
                        <span class="material-icons">schedule</span>
                        <span>We typically respond within 24 hours</span>
                    </div>
                </div>
            </div>
        {:else}
            <LoginForm on:titleupdate={handleLoginTitleUpdate} />
        {/if}
    </main>
</div>

<style>
    .app-container {
        min-height: 100vh;
        max-width: 1200px;
        margin: 0 auto;
        padding: var(--md-spacing-md);
    }

    .app-header {
        margin-bottom: var(--md-spacing-lg);
        background: linear-gradient(
            135deg,
            var(--md-primary) 0%,
            var(--md-primary-dark) 100%
        );
        color: white;
        position: relative;
        overflow: hidden;
    }

    .app-header::before {
        content: "";
        position: absolute;
        top: -50%;
        right: -50%;
        width: 200%;
        height: 200%;
        background: linear-gradient(
            45deg,
            transparent 30%,
            rgba(255, 255, 255, 0.1) 50%,
            transparent 70%
        );
        transform: rotate(45deg);
        pointer-events: none;
    }

    .header-content {
        position: relative;
        z-index: 1;
    }

    .header-top {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        margin-bottom: var(--md-spacing-xs);
    }

    .header-nav {
        display: flex;
        gap: var(--md-spacing-xs);
        align-items: center;
    }

    .nav-link {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 2px;
        padding: 6px var(--md-spacing-sm);
        background-color: transparent;
        border: 1px solid rgba(255, 255, 255, 0.3);
        border-radius: var(--md-radius-sm);
        color: white;
        font-size: var(--md-font-caption);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--md-transition-standard);
        text-transform: none;
        min-width: 56px;
    }

    .nav-link:hover {
        background-color: rgba(255, 255, 255, 0.1);
        border-color: rgba(255, 255, 255, 0.5);
        transform: translateY(-1px);
        box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }

    .nav-link:active {
        transform: translateY(0);
        box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
    }

    .nav-link:focus-visible {
        outline: 3px solid var(--md-secondary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(3, 218, 198, 0.3);
    }

    .nav-link .material-icons {
        font-size: 18px;
        color: var(--md-secondary);
    }

    .app-title {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        font-size: 2rem;
        font-weight: 300;
        margin-bottom: var(--md-spacing-xs);
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .app-subtitle {
        font-size: var(--md-font-body2);
        opacity: 0.9;
        font-weight: 400;
        line-height: 1.4;
        margin-bottom: var(--md-spacing-md);
    }

    .user-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: var(--md-spacing-md);
        border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-details {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        font-size: var(--md-font-body1);
        font-weight: 500;
    }

    .user-icon {
        font-size: 1.5rem;
        color: var(--md-secondary);
    }

    .logout-btn {
        gap: var(--md-spacing-xs);
        border-color: rgba(255, 255, 255, 0.5);
        color: white;
    }

    .logout-btn:hover {
        background-color: rgba(255, 255, 255, 0.1);
        border-color: white;
    }

    .logout-btn:focus-visible {
        outline: 3px solid white;
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(255, 255, 255, 0.3);
    }

    .main-content {
        animation: fadeIn 0.5s ease-in-out;
    }

    .support-section {
        margin-top: var(--md-spacing-lg);
        text-align: center;
    }

    .support-header {
        margin-bottom: var(--md-spacing-md);
    }

    .support-icon {
        font-size: 2rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-sm);
    }

    .support-header h3 {
        margin-bottom: var(--md-spacing-xs);
        color: var(--md-on-surface);
        font-size: 1.25rem;
    }

    .support-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0 auto var(--md-spacing-md);
        max-width: 500px;
        line-height: 1.4;
    }

    .support-actions {
        display: flex;
        gap: var(--md-spacing-sm);
        justify-content: center;
        margin-bottom: var(--md-spacing-md);
        flex-wrap: wrap;
    }

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
        min-width: 160px;
        justify-content: center;
        text-transform: none;
    }

    .support-button.primary {
        background-color: var(--md-primary);
        color: white;
        border: none;
    }

    .support-button.primary:hover {
        background-color: var(--md-primary-dark);
        box-shadow: var(--md-elevation-2);
        transform: translateY(-1px);
    }

    .support-button.secondary {
        background-color: transparent;
        color: var(--md-primary);
        border: 2px solid var(--md-primary);
    }

    .support-button.secondary:hover {
        background-color: var(--md-primary);
        color: white;
        box-shadow: var(--md-elevation-2);
        transform: translateY(-1px);
    }

    .support-button:active {
        transform: translateY(0);
        box-shadow: var(--md-elevation-1);
    }

    .support-button:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
    }

    .support-button.primary:focus-visible {
        outline: 3px solid var(--md-primary-dark);
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.3);
    }

    .support-button.secondary:focus-visible {
        outline: 3px solid var(--md-primary);
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .support-info {
        display: flex;
        justify-content: center;
        gap: var(--md-spacing-lg);
        padding-top: var(--md-spacing-md);
        border-top: 1px solid var(--md-outline-variant);
        flex-wrap: wrap;
    }

    .support-item {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
    }

    .support-item .material-icons {
        font-size: 16px;
        color: var(--md-primary);
    }

    .logo-icon-small {
        width: 48px;
        height: 48px;
        margin-right: 8px;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
            transform: translateY(20px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @media (max-width: 768px) {
        .app-container {
            padding: var(--md-spacing-sm);
        }

        .header-top {
            flex-direction: column;
            gap: var(--md-spacing-md);
            align-items: center;
            text-align: center;
        }

        .header-nav {
            order: -1;
            gap: var(--md-spacing-xs);
        }

        .nav-link {
            min-width: 50px;
            padding: var(--md-spacing-xs) var(--md-spacing-sm);
            font-size: var(--md-font-caption);
        }

        .nav-link .material-icons {
            font-size: 18px;
        }

        .nav-link span:last-child {
            font-size: 0.7rem;
        }

        .app-title {
            font-size: 1.5rem;
            flex-direction: column;
            text-align: center;
            gap: var(--md-spacing-xs);
        }

        .user-info {
            flex-direction: column;
            gap: var(--md-spacing-md);
            text-align: center;
        }

        .logout-btn {
            width: 100%;
        }

        .support-actions {
            flex-direction: column;
            align-items: center;
        }

        .support-button {
            min-width: 200px;
            width: 100%;
            max-width: 300px;
        }

        .support-info {
            flex-direction: column;
            gap: var(--md-spacing-md);
            text-align: center;
        }

        .support-description {
            font-size: var(--md-font-body2);
            padding: 0 var(--md-spacing-sm);
        }
    }
</style>
