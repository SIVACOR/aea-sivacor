<script>
    import { createEventDispatcher } from "svelte";

    export let message = "";
    const dispatch = createEventDispatcher();

    function dismiss() {
        dispatch("dismiss");
    }
</script>

<div class="banner">
    <p>{message}</p>
    <button on:click={dismiss}>&times;</button>
</div>

<style>
    .banner {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 1rem;
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
        font-size: 1.5rem;
        cursor: pointer;
    }
</style>
