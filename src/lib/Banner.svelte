<script lang="ts">
    import { createEventDispatcher } from "svelte";

    export let message = "";
    const dispatch = createEventDispatcher();

    function dismiss() {
        dispatch("dismiss");
    }
</script>

<div class="banner" role="region" aria-label="Notification banner">
    <p>{message}</p>
    <button on:click={dismiss} aria-label="Close notification">&times;</button>
</div>

<style>
    .banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 0.5rem 1rem;
        background-color: #ffcc00;
        color: #333;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        z-index: 9999;
    }

    p {
        margin: 0;
    }

    button {
        background: none;
        border: none;
        font-size: 1.25rem;
        cursor: pointer;
        padding: 0.25rem;
        line-height: 1;
    }

    button:focus-visible {
        outline: 3px solid #333;
        outline-offset: 2px;
        border-radius: 4px;
    }
</style>
