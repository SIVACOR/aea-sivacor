<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import {
        getWorkflowSchema,
        type WorkflowDefinition,
        type WorkflowStage,
    } from "./api";
    import type { ValidateFunction } from "ajv";

    /**
     * Available images and their tags, as loaded by the parent. An imported
     * definition is checked against these: submit_job rejects an image outside
     * the allow-list, and the form's dropdowns cannot represent one either, so
     * catching it here beats populating the form with something unselectable.
     */
    export let imagesData: Record<string, string[]> = {};
    export let disabled = false;

    const ALLOWED_EXTENSIONS = [".yaml", ".yml", ".json"];
    /**
     * A workflow definition is a handful of lines; anything this large is a file
     * picked by mistake, and reading it into memory to fail schema validation
     * helps nobody.
     */
    const MAX_FILE_SIZE = 256 * 1024;

    const dispatch = createEventDispatcher();

    let isParsing = false;
    let isDragging = false;
    /** Mirrors the <details> open state; drives the chevron only. */
    let isExpanded = false;
    let importMessage: string | null = null;
    /** Schema violations etc., listed in full rather than first-error-only. */
    let importErrors: string[] = [];

    /**
     * Compiled validator for the schema served by the backend. Both the fetch and
     * the ajv import are deferred to the first import attempt: most submissions
     * are filled in by hand and should not pay for either.
     * @type {Promise<ValidateFunction> | null}
     */
    let validatorPromise: Promise<ValidateFunction> | null = null;

    function loadValidator(): Promise<ValidateFunction> {
        if (!validatorPromise) {
            validatorPromise = (async () => {
                const [{ default: Ajv }, schema] = await Promise.all([
                    import("ajv"),
                    getWorkflowSchema(),
                ]);
                // The server declares draft-04, which ajv 8 does not ship; every
                // keyword the schema actually uses is spelled the same in the
                // draft ajv defaults to, so drop the declaration rather than
                // pulling in ajv-draft-04.
                const draftless = { ...schema };
                delete draftless.$schema;
                const ajv = new Ajv({
                    allErrors: true,
                    strict: false,
                    // Fills in network_isolation from the schema's `default`.
                    useDefaults: true,
                    // `image_tag: 18` in YAML is the number 18, not "18", and
                    // demanding quotes around every tag would be a poor trade.
                    // A coercion that produces a tag nobody publishes is caught
                    // by the allow-list check below.
                    coerceTypes: true,
                });
                return ajv.compile(draftless);
            })();
            // Don't cache a failed fetch: the next attempt should retry.
            validatorPromise.catch(() => {
                validatorPromise = null;
            });
        }
        return validatorPromise;
    }

    /**
     * Parses YAML or JSON. js-yaml handles both (JSON is a subset of YAML), but
     * .json goes through JSON.parse so its errors name a position in the file.
     */
    async function parseWorkflow(text: string, fileName: string) {
        if (fileName.toLowerCase().endsWith(".json")) {
            return JSON.parse(text);
        }
        const yaml = await import("js-yaml");
        return yaml.load(text);
    }

    /**
     * Names a few values and counts the rest: an image can carry twenty tags,
     * and spelling them all out buries the error message they belong to.
     */
    function summarize(values: string[], max = 5): string {
        if (values.length <= max) {
            return values.join(", ");
        }
        return `${values.slice(0, max).join(", ")} (+${values.length - max} more)`;
    }

    /**
     * Checks what the schema cannot: that the images exist, that a main file was
     * actually named, and that secret keys are usable as environment variables.
     * @returns {string[]} Human-readable problems; empty when the file is usable.
     */
    function validateAgainstForm(definition: WorkflowDefinition): string[] {
        const problems: string[] = [];
        const knownImages = Object.keys(imagesData);

        definition.stages.forEach((stage: WorkflowStage, index: number) => {
            const step = `Step ${index + 1}`;
            if (!stage.main_file.trim()) {
                problems.push(`${step}: main_file is empty.`);
            }
            // Skipped when the image list failed to load, so a transient
            // /sivacor/image_tags outage does not block importing a good file --
            // submit_job re-checks the allow-list anyway.
            if (knownImages.length === 0) {
                return;
            }
            if (!knownImages.includes(stage.image_name)) {
                problems.push(
                    `${step}: unknown image "${stage.image_name}". ` +
                        "Pick a supported one from the Docker Image list below.",
                );
            } else if (!imagesData[stage.image_name].includes(stage.image_tag)) {
                problems.push(
                    `${step}: image "${stage.image_name}" has no tag ` +
                        `"${stage.image_tag}". Available: ` +
                        `${summarize(imagesData[stage.image_name])}.`,
                );
            }
        });

        // A plain array, not a Set: these lists are a handful of entries, and a
        // Set here would trip svelte/prefer-svelte-reactivity for no gain.
        const seenKeys: string[] = [];
        for (const { key } of definition.env_secrets ?? []) {
            if (!key.trim()) {
                problems.push("A secret in env_secrets has an empty key.");
            } else if (seenKeys.includes(key)) {
                problems.push(`Duplicate secret key "${key}" in env_secrets.`);
            }
            seenKeys.push(key);
        }

        return problems;
    }

    function handleFileSelect(event: Event) {
        const target = event.target as HTMLInputElement;
        const file = target?.files?.[0];
        // Always let the same file be picked again: after a failed import the
        // user fixes the file on disk and re-selects it, which fires no change
        // event unless the input has been cleared.
        target.value = "";
        if (file) {
            importFile(file);
        }
    }

    function handleDragOver(event: DragEvent) {
        event.preventDefault();
        isDragging = true;
    }

    function handleDragLeave() {
        isDragging = false;
    }

    function handleDrop(event: DragEvent) {
        event.preventDefault();
        isDragging = false;
        // The form is frozen mid-submission; a drop here would rewrite the very
        // steps that are already on their way to the server.
        if (disabled || isParsing) {
            return;
        }
        const file = event.dataTransfer?.files?.[0];
        if (file) {
            importFile(file);
        }
    }

    /**
     * Validates one file and, if it holds a usable workflow, hands it to the
     * parent. Shared by the file picker and the drop zone so a dropped file goes
     * through exactly the same checks as a chosen one.
     */
    async function importFile(file: File) {
        importMessage = null;
        importErrors = [];

        const name = file.name.toLowerCase();
        if (!ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext))) {
            importErrors = [
                `Invalid file type. Please select a YAML or JSON file (${ALLOWED_EXTENSIONS.join(", ")}).`,
            ];
            return;
        }
        if (file.size > MAX_FILE_SIZE) {
            importErrors = [
                `${file.name} is too large for a workflow definition (max ${MAX_FILE_SIZE / 1024} KB).`,
            ];
            return;
        }

        isParsing = true;
        try {
            // Kept out of the catch below, whose message blames the file: a
            // schema the server would not hand over is not the user's typo.
            let validate: ValidateFunction;
            try {
                validate = await loadValidator();
            } catch (error) {
                console.error("Could not load the workflow schema:", error);
                importErrors = [
                    "Could not fetch the workflow schema from the server, so " +
                        "the file cannot be checked. Please try again, or fill " +
                        "in the steps below by hand.",
                ];
                return;
            }

            const parsed = await parseWorkflow(await file.text(), file.name);

            if (!validate(parsed)) {
                importErrors = (validate.errors ?? []).map(
                    (error) =>
                        `${error.instancePath || "workflow"} ${error.message}`,
                );
                return;
            }

            // Past validate(), so the shape is the schema's -- and useDefaults
            // has filled in the optional network_isolation.
            const definition = parsed as WorkflowDefinition;
            const problems = validateAgainstForm(definition);
            if (problems.length > 0) {
                importErrors = problems;
                return;
            }

            const stageCount = definition.stages.length;
            const secretCount = definition.env_secrets?.length ?? 0;
            importMessage =
                `Imported ${stageCount} ${stageCount === 1 ? "step" : "steps"}` +
                (secretCount > 0
                    ? ` and ${secretCount} ${secretCount === 1 ? "secret" : "secrets"}`
                    : "") +
                ` from ${file.name}. Review the form below before running.`;
            dispatch("import", definition);
        } catch (error) {
            console.error("Workflow import failed:", error);
            const detail =
                error instanceof Error ? error.message : "Unknown error";
            importErrors = [`Could not read ${file.name}: ${detail}`];
        } finally {
            isParsing = false;
        }
    }
</script>

<!-- Collapsed by default (#37): most submissions are a single step filled in by
     hand, and an expanded import panel above the form reads as a required first
     step. Native <details> rather than a bound flag so the disclosure keeps its
     keyboard and screen-reader behaviour for free. -->
<details class="import-section" bind:open={isExpanded}>
    <summary class="import-header">
        <span class="material-icons import-icon" aria-hidden="true">
            upload_file
        </span>
        <span class="import-title">Optional: Import workflow definition</span>
        <span class="import-hint">
            Configure multiple steps based on a file
        </span>
        <span class="material-icons import-chevron" aria-hidden="true">
            {isExpanded ? "expand_less" : "expand_more"}
        </span>
    </summary>

    <!-- Wrapper rather than laying the panel out on <details> itself: a
         flex/grid display on the element breaks the collapsed state in some
         browsers. -->
    <div class="import-body">
        <div
            class="import-area"
            class:disabled={disabled || isParsing}
            class:is-dragging={isDragging}
            on:dragover={handleDragOver}
            on:dragenter={handleDragOver}
            on:dragleave={handleDragLeave}
            on:drop={handleDrop}
            role="region"
            aria-label="Workflow definition drop zone"
            aria-describedby="workflow-import-instructions"
        >
            <label for="workflow-import-input" class="import-input-label">
                <span class="material-icons import-file-icon" aria-hidden="true">
                    description
                </span>
                <div class="import-input-text">
                    <strong>Choose a workflow file</strong> or drag it here
                    <small id="workflow-import-instructions">
                        Supported formats: YAML, JSON ({ALLOWED_EXTENSIONS.join(
                            ", ",
                        )}) • Max size: {MAX_FILE_SIZE / 1024} KB
                    </small>
                </div>
            </label>
            <input
                type="file"
                id="workflow-import-input"
                class="import-input"
                on:change={handleFileSelect}
                disabled={disabled || isParsing}
                accept=".yaml,.yml,.json,application/json,application/yaml,text/yaml"
                aria-label="Choose a workflow definition file to import"
            />
        </div>
        <!-- Live region to announce drag state changes to assistive technologies -->
        <div class="sr-only" aria-live="polite" aria-atomic="true">
            {isDragging ? "File detected. Release to import." : ""}
        </div>

        <details class="import-example">
            <summary>Expected format</summary>
            <pre>{`stages:
      - image_name: ${Object.keys(imagesData)[0] ?? "some/image"}
        image_tag: "${imagesData[Object.keys(imagesData)[0]]?.[0] ?? "latest"}"
        main_file: main.do
        network_isolation: true
    env_secrets:
      - key: API_TOKEN
        value: s3cret`}</pre>
            <p>
                <code>network_isolation</code> and <code>env_secrets</code> are
                optional. Secrets are read from the file into this form only — like
                secrets typed by hand, they are never saved in your browser.
            </p>
        </details>

        {#if isParsing}
            <div class="import-status" role="status">
                <div class="md-spinner"></div>
                <span>Validating workflow definition…</span>
            </div>
        {:else if importMessage}
            <div class="import-status success" role="status">
                <span class="material-icons" aria-hidden="true">check_circle</span>
                <span>{importMessage}</span>
            </div>
        {:else if importErrors.length > 0}
            <div class="import-status error" role="alert">
                <span class="material-icons" aria-hidden="true">error</span>
                <div class="error-body">
                    <strong>The workflow definition could not be imported:</strong>
                    <ul>
                        <!-- Keyed by index: two stages can fail the same way, so
                             the message itself is not unique. -->
                        {#each importErrors as problem, index (index)}
                            <li>{problem}</li>
                        {/each}
                    </ul>
                </div>
            </div>
        {/if}
    </div>
</details>

<style>
    /* Solid, like .config-row in JobRunner: the dashed border belongs to the
       drop zone inside, and nesting two of them reads as a mistake. */
    .import-section {
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-md);
        background: var(--md-surface-container-lowest);
    }

    .import-body {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-sm);
        margin-top: var(--md-spacing-sm);
    }

    /* The whole header is the disclosure control, per #37 ("clicking on text
       unfolds"), so it must fill the row and carry the pointer. */
    .import-header {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--md-spacing-sm);
        cursor: pointer;
        /* Suppress the native triangle in favour of the chevron below; Firefox
           needs list-style, WebKit needs the pseudo-element. */
        list-style: none;
    }

    .import-header::-webkit-details-marker {
        display: none;
    }

    .import-header:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        border-radius: var(--md-radius-xs);
    }

    .import-header:hover .import-title {
        color: var(--md-primary);
    }

    .import-chevron {
        font-size: 1.25rem;
        color: var(--md-on-surface-variant);
        margin-left: auto;
    }

    .import-icon {
        font-size: 1rem;
        color: var(--md-primary-dark, #1565c0);
    }

    .import-title {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--md-on-surface);
    }

    .import-hint {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        flex: 1;
    }

    /* Drop zone, mirroring FileUploader's .upload-area: the label is the visible
       target and the native input is stretched invisibly across it, so a click
       anywhere in the zone opens the picker. */
    .import-area {
        position: relative;
    }

    .import-area.disabled {
        opacity: 0.6;
        pointer-events: none;
    }

    .import-input-label {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: var(--md-spacing-md);
        border: 2px dashed var(--md-outline);
        border-radius: var(--md-radius-md);
        background-color: var(--md-surface-variant);
        cursor: pointer;
        transition: all var(--md-transition-standard);
    }

    .import-area:focus-within .import-input-label {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        border-color: var(--md-primary);
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.2);
    }

    .import-area.is-dragging .import-input-label {
        border-color: var(--md-primary);
        background-color: rgba(25, 118, 210, 0.1);
        transform: scale(1.02);
    }

    .import-file-icon {
        font-size: 1.5rem;
        color: var(--md-primary);
        margin-bottom: var(--md-spacing-xs);
    }

    .import-input-text {
        text-align: center;
    }

    .import-input-text strong {
        display: block;
        color: var(--md-on-surface);
        font-size: var(--md-font-body2);
        margin-bottom: 2px;
    }

    .import-input-text small {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
    }

    .import-input {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        opacity: 0;
        cursor: pointer;
    }

    /* Visually hidden but accessible to screen readers */
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }

    .import-example {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
    }

    .import-example summary {
        cursor: pointer;
        font-weight: 500;
    }

    .import-example summary:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
    }

    .import-example pre {
        margin: var(--md-spacing-xs) 0;
        padding: var(--md-spacing-sm);
        overflow-x: auto;
        background: var(--md-surface-variant);
        border-radius: var(--md-radius-xs);
        font-family: "Courier New", monospace;
        font-size: 0.75rem;
        line-height: 1.4;
        color: var(--md-on-surface);
    }

    .import-example code {
        font-family: "Courier New", monospace;
        background: var(--md-surface-variant);
        padding: 1px 4px;
        border-radius: var(--md-radius-xs);
    }

    .import-status {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-body2);
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
    }

    .import-status .material-icons {
        font-size: 1.125rem;
    }

    .import-status.success {
        background-color: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
        color: var(--md-success);
    }

    .import-status.error {
        background-color: rgba(244, 67, 54, 0.1);
        border: 1px solid rgba(244, 67, 54, 0.3);
        color: var(--md-error);
    }

    .error-body ul {
        margin: var(--md-spacing-xs) 0 0 0;
        padding-left: var(--md-spacing-md);
    }

    .error-body li {
        line-height: 1.4;
    }
</style>
