<script>
    import { user } from "../lib/stores";
    import { logout } from "../lib/api";
    import LoginForm from "../lib/LoginForm.svelte";
    import JobMonitor from "../lib/JobMonitor.svelte";

    // A reactive statement to determine if the user is logged in
    $: isAuthenticated = $user !== null;
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
    }
</style>
