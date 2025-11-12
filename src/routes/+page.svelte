<script>
    import { user } from '../lib/stores';
    import { logout } from '../lib/api';
    import LoginForm from '../lib/LoginForm.svelte';
    import JobMonitor from '../lib/JobMonitor.svelte';

    // A reactive statement to determine if the user is logged in
    $: isAuthenticated = $user !== null;
</script>

<main>
    <h1>SIVACOR</h1>
    <h3>Scalable Infrastructure for Validation of Computational Social Science Research</h3>

    {#if isAuthenticated}
        <h2>Hello {$user.firstName} {$user.lastName}</h2>
        <button on:click={logout}>Logout</button>
        <JobMonitor />
    {:else}
        <LoginForm />
    {/if}
</main>

<style>
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
