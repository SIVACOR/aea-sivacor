<script>
    import { user } from '../lib/stores';
    import { logout } from '../lib/api';
    import LoginForm from '../lib/LoginForm.svelte';
    import FileUploader from '../lib/FileUploader.svelte';

    // A reactive statement to determine if the user is logged in
    $: isAuthenticated = $user !== null;
</script>

<main>
    <h1>SvelteKit Authentication Demo</h1>

    {#if isAuthenticated}
        <h2>Hello {$user.firstName} {$user.lastName}</h2>
        <button on:click={logout}>Logout</button>
        <hr>
        <FileUploader />
    {:else}
        <LoginForm />
    {/if}
</main>

<style>
    /* Basic styling for demonstration */
    main {
        padding: 20px;
        font-family: sans-serif;
    }
    button {
        padding: 10px 20px;
        background-color: #f44336;
        color: white;
        border: none;
        cursor: pointer;
        border-radius: 4px;
        margin-top: 10px;
    }
</style>
