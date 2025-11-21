<script>
    import { user } from "../lib/stores";
    import { logout } from "../lib/api";
    import LoginForm from "../lib/LoginForm.svelte";
    import JobMonitor from "../lib/JobMonitor.svelte";

    // A reactive statement to determine if the user is logged in
    $: isAuthenticated = $user !== null;

    /**
     * Opens email client to send general support email.
     */
    function sendSupportEmail() {
        const subject = encodeURIComponent("SIVACOR Support Request");
        const body = encodeURIComponent(
            `Hello SIVACOR Support Team,\n\nI have a question/need assistance with the SIVACOR application.\n\nUser: ${$user ? `${$user.firstName} ${$user.lastName}` : "Anonymous"}\n\nDescription of my question/issue:\n[Please describe your question or issue here]\n\nThank you for your assistance,`,
        );
        window.location.href = `mailto:support@sivacor.org?subject=${subject}&body=${body}`;
    }

    /**
     * Opens email client to send feedback email.
     */
    function sendFeedback() {
        const subject = encodeURIComponent("SIVACOR Feedback");
        const body = encodeURIComponent(
            `Hello SIVACOR Team,\n\nI would like to provide feedback about the SIVACOR application.\n\nUser: ${$user ? `${$user.firstName} ${$user.lastName}` : "Anonymous"}\n\nFeedback:\n[Please share your feedback, suggestions, or feature requests here]\n\nThank you,`,
        );
        window.location.href = `mailto:support@sivacor.org?subject=${subject}&body=${body}`;
    }
</script>

<div class="app-container">
    <header class="app-header md-card">
        <div class="header-content">
            <h1 class="app-title">
                <span class="material-icons">science</span>
                SIVACOR
            </h1>
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
                            >Hello, {$user.firstName} {$user.lastName}</span
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
            <JobMonitor />

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
                        on:click={sendSupportEmail}
                        class="support-button primary"
                    >
                        <span class="material-icons">mail</span>
                        Contact Support
                    </button>

                    <button
                        on:click={sendFeedback}
                        class="support-button secondary"
                    >
                        <span class="material-icons">feedback</span>
                        Send Feedback
                    </button>
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
            <LoginForm />
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
        margin-bottom: var(--md-spacing-xl);
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

    .app-title {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-md);
        font-size: 2.5rem;
        font-weight: 300;
        margin-bottom: var(--md-spacing-sm);
        text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    }

    .app-title .material-icons {
        font-size: 3rem;
        color: var(--md-secondary);
    }

    .app-subtitle {
        font-size: var(--md-font-subtitle1);
        opacity: 0.9;
        font-weight: 400;
        line-height: 1.4;
        margin-bottom: var(--md-spacing-lg);
    }

    .user-info {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding-top: var(--md-spacing-lg);
        border-top: 1px solid rgba(255, 255, 255, 0.2);
    }

    .user-details {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        font-size: var(--md-font-subtitle1);
        font-weight: 500;
    }

    .user-icon {
        font-size: 2rem;
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

    .main-content {
        animation: fadeIn 0.5s ease-in-out;
    }

    .support-section {
        margin-top: var(--md-spacing-xl);
        text-align: center;
    }

    .support-header {
        margin-bottom: var(--md-spacing-lg);
    }

    .support-icon {
        font-size: 3rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-md);
    }

    .support-header h3 {
        margin-bottom: var(--md-spacing-sm);
        color: var(--md-on-surface);
    }

    .support-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        margin: 0 auto var(--md-spacing-lg);
        max-width: 500px;
        line-height: 1.5;
    }

    .support-actions {
        display: flex;
        gap: var(--md-spacing-md);
        justify-content: center;
        margin-bottom: var(--md-spacing-lg);
        flex-wrap: wrap;
    }

    .support-button {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md) var(--md-spacing-lg);
        border-radius: var(--md-radius-sm);
        font-size: var(--md-font-body1);
        font-weight: 500;
        cursor: pointer;
        transition: all var(--md-transition-standard);
        min-width: 180px;
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

    .support-info {
        display: flex;
        justify-content: center;
        gap: var(--md-spacing-xl);
        padding-top: var(--md-spacing-lg);
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

        .app-title {
            font-size: 2rem;
            flex-direction: column;
            text-align: center;
            gap: var(--md-spacing-sm);
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
