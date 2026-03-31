<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let privacyPolicyUrl = "/privacy";

    const dispatch = createEventDispatcher();

    function dismiss() {
        dispatch("dismiss");
    }
</script>

<div class="cookie-notice" role="region" aria-label="Cookie and storage notice">
    <p class="notice-text">
        <span class="material-icons notice-icon" aria-hidden="true">info</span>
        This site uses a <strong>functional cookie</strong> (<code
            >girderToken</code
        >) to keep you logged in for up to 7 days, and saves your last-used job
        configuration in <strong>browser localStorage</strong>. No tracking or
        advertising cookies are used.
        <a href={privacyPolicyUrl}>Learn more in our Privacy Policy.</a>
    </p>
    <button
        class="dismiss-btn"
        on:click={dismiss}
        aria-label="Dismiss cookie notice"
    >
        <span class="material-icons" aria-hidden="true">close</span>
    </button>
</div>

<style>
    .cookie-notice {
        position: fixed;
        bottom: 0;
        left: 0;
        right: 0;
        z-index: 1000;
        display: flex;
        align-items: center;
        gap: var(--md-spacing-md);
        padding: var(--md-spacing-sm) var(--md-spacing-lg);
        background: var(--md-on-surface);
        color: var(--md-surface);
        font-size: 0.875rem;
        line-height: 1.5;
        box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.2);
    }

    .notice-text {
        flex: 1;
        margin: 0;
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 0.3em;
    }

    .notice-icon {
        font-size: 1rem;
        vertical-align: middle;
        opacity: 0.85;
        flex-shrink: 0;
    }

    .notice-text a {
        color: var(--md-primary-light, #90caf9);
        text-decoration: underline;
        white-space: nowrap;
    }

    .notice-text a:hover {
        color: #fff;
    }

    code {
        background: rgba(255, 255, 255, 0.15);
        padding: 1px 4px;
        border-radius: 3px;
        font-size: 0.8125rem;
    }

    .dismiss-btn {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        color: var(--md-surface);
        cursor: pointer;
        padding: var(--md-spacing-xs);
        border-radius: 4px;
        opacity: 0.8;
        transition: opacity 0.15s;
    }

    .dismiss-btn:hover {
        opacity: 1;
    }

    .dismiss-btn:focus-visible {
        outline: 2px solid var(--md-primary-light, #90caf9);
        outline-offset: 2px;
    }

    @media (max-width: 600px) {
        .cookie-notice {
            flex-direction: column;
            align-items: flex-start;
            gap: var(--md-spacing-sm);
        }

        .dismiss-btn {
            align-self: flex-end;
        }
    }
</style>
