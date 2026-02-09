<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { updateUserEmail, checkAuthentication } from "./api";

    export let show = false;
    export let currentEmail = "";

    const dispatch = createEventDispatcher();

    let newEmail = "";
    let isSubmitting = false;
    let errorMessage = "";
    let successMessage = "";

    /**
     * Validates email format
     */
    function isValidEmail(email: string): boolean {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    /**
     * Handles form submission
     */
    async function handleSubmit() {
        errorMessage = "";
        successMessage = "";

        if (!newEmail.trim()) {
            errorMessage = "Please enter an email address.";
            return;
        }

        if (!isValidEmail(newEmail)) {
            errorMessage = "Please enter a valid email address.";
            return;
        }

        if (newEmail.toLowerCase() === currentEmail.toLowerCase()) {
            errorMessage = "Please enter a different email address.";
            return;
        }

        isSubmitting = true;

        try {
            await updateUserEmail(newEmail);
            successMessage = "Email updated successfully!";

            // Refresh user data
            await checkAuthentication();

            // Close modal after a brief delay to show success message
            setTimeout(() => {
                handleClose();
                dispatch("emailupdated");
            }, 1500);
        } catch (error) {
            errorMessage =
                error instanceof Error
                    ? error.message
                    : "Failed to update email. Please try again.";
        } finally {
            isSubmitting = false;
        }
    }

    /**
     * Handles modal close
     */
    function handleClose() {
        if (isSubmitting) return;
        show = false;
        newEmail = "";
        errorMessage = "";
        successMessage = "";
        dispatch("close");
    }

    /**
     * Handles backdrop click
     */
    function handleBackdropClick(event: MouseEvent) {
        if (event.target === event.currentTarget) {
            handleClose();
        }
    }

    /**
     * Handles escape key
     */
    function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape" && show && !isSubmitting) {
            handleClose();
        }
    }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if show}
    <!-- svelte-ignore a11y-click-events-have-key-events -->
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="modal-backdrop" on:click={handleBackdropClick}>
        <div class="modal-container md-card md-card-elevated">
            <div class="modal-header">
                <h3>Update Email Address</h3>
                <button
                    class="close-button"
                    on:click={handleClose}
                    disabled={isSubmitting}
                    aria-label="Close"
                >
                    <span class="material-icons">close</span>
                </button>
            </div>

            <div class="modal-body">
                <p class="modal-description">
                    Enter a new email address for your SIVACOR account. This
                    will be used for notifications and communication.
                </p>

                <div class="current-email-display">
                    <span class="label">Current Email:</span>
                    <span class="email">{currentEmail}</span>
                </div>

                <form on:submit|preventDefault={handleSubmit}>
                    <div class="form-group">
                        <label for="new-email">New Email Address</label>
                        <input
                            id="new-email"
                            type="email"
                            bind:value={newEmail}
                            placeholder="your.email@example.com"
                            disabled={isSubmitting}
                            autocomplete="email"
                            required
                        />
                    </div>

                    {#if errorMessage}
                        <div class="message error-message">
                            <span class="material-icons">error</span>
                            <span>{errorMessage}</span>
                        </div>
                    {/if}

                    {#if successMessage}
                        <div class="message success-message">
                            <span class="material-icons">check_circle</span>
                            <span>{successMessage}</span>
                        </div>
                    {/if}

                    <div class="modal-actions">
                        <button
                            type="button"
                            class="md-button-text"
                            on:click={handleClose}
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            class="md-button-filled"
                            disabled={isSubmitting}
                        >
                            {#if isSubmitting}
                                <div class="md-spinner small"></div>
                                Updating...
                            {:else}
                                Update Email
                            {/if}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
{/if}

<style>
    .modal-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        padding: var(--md-spacing-md);
        animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    .modal-container {
        background: white;
        border-radius: var(--md-border-radius);
        max-width: 500px;
        width: 100%;
        max-height: 90vh;
        overflow: auto;
        animation: slideUp 0.3s ease-out;
    }

    @keyframes slideUp {
        from {
            transform: translateY(20px);
            opacity: 0;
        }
        to {
            transform: translateY(0);
            opacity: 1;
        }
    }

    .modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: var(--md-spacing-lg);
        border-bottom: 1px solid var(--md-outline-variant);
    }

    .modal-header h3 {
        margin: 0;
        font-size: var(--md-font-h6);
        font-weight: 500;
        color: var(--md-on-surface);
    }

    .close-button {
        background: none;
        border: none;
        cursor: pointer;
        padding: var(--md-spacing-xs);
        border-radius: 50%;
        color: var(--md-on-surface-variant);
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        justify-content: center;
    }

    .close-button:hover:not(:disabled) {
        background: var(--md-surface-variant);
        color: var(--md-on-surface);
    }

    .close-button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .close-button:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .modal-body {
        padding: var(--md-spacing-lg);
    }

    .modal-description {
        margin: 0 0 var(--md-spacing-lg);
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-body2);
        line-height: 1.5;
    }

    .current-email-display {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-md);
        background: var(--md-surface-variant);
        border-radius: var(--md-radius-xs);
        margin-bottom: var(--md-spacing-lg);
    }

    .current-email-display .label {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .current-email-display .email {
        font-size: var(--md-font-body1);
        color: var(--md-on-surface);
        font-family: monospace;
    }

    .form-group {
        margin-bottom: var(--md-spacing-lg);
    }

    .form-group label {
        display: block;
        margin-bottom: var(--md-spacing-sm);
        font-size: var(--md-font-body2);
        font-weight: 500;
        color: var(--md-on-surface);
    }

    .form-group input {
        width: 100%;
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-body1);
        transition: border-color 0.2s ease;
    }

    .form-group input:focus {
        outline: none;
        border-color: var(--md-primary);
    }

    .form-group input:disabled {
        background: var(--md-surface-variant);
        cursor: not-allowed;
    }

    .message {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border-radius: var(--md-radius-xs);
        margin-bottom: var(--md-spacing-md);
        font-size: var(--md-font-body2);
    }

    .error-message {
        background: #fde7e9;
        color: #c62828;
        border: 1px solid #ef5350;
    }

    .error-message .material-icons {
        color: #c62828;
    }

    .success-message {
        background: #e8f5e9;
        color: #2e7d32;
        border: 1px solid #66bb6a;
    }

    .success-message .material-icons {
        color: #2e7d32;
    }

    .modal-actions {
        display: flex;
        justify-content: flex-end;
        gap: var(--md-spacing-sm);
        margin-top: var(--md-spacing-lg);
    }

    .md-button-text,
    .md-button-filled {
        padding: var(--md-spacing-sm) var(--md-spacing-lg);
        border: none;
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-body2);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
    }

    .md-button-text {
        background: none;
        color: var(--md-primary);
    }

    .md-button-text:hover:not(:disabled) {
        background: var(--md-surface-variant);
    }

    .md-button-filled {
        background: var(--md-primary);
        color: white;
    }

    .md-button-filled:hover:not(:disabled) {
        background: var(--md-primary-dark);
        box-shadow: var(--md-shadow-md);
    }

    .md-button-text:disabled,
    .md-button-filled:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .md-button-text:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .md-button-filled:focus-visible {
        outline: 3px solid var(--md-primary-dark);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.3);
    }

    .md-spinner.small {
        width: 16px;
        height: 16px;
        border-width: 2px;
    }

    @media (max-width: 768px) {
        .modal-container {
            max-width: 100%;
            margin: var(--md-spacing-md);
        }

        .modal-header,
        .modal-body {
            padding: var(--md-spacing-md);
        }
    }
</style>
