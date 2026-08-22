<script lang="ts">
    import { onMount, tick } from "svelte";
    import { createEventDispatcher } from "svelte";
    import {
        submitJob,
        getImages,
        getVolumeQuota,
        getWorkerSizes,
        grantedVolumeGb,
        volumeCeilingGb,
        volumeRefusal,
        type ApiError,
        type PreviousRunPeaks,
        type VolumeQuota,
        type WorkerSize,
        type WorkflowDefinition,
    } from "./api";
    import { formatBytes } from "./format";
    import FileUploader from "./FileUploader.svelte";
    import WorkflowImport from "./WorkflowImport.svelte";
    import { hasInvalidOrcidEmail, user } from "./stores";
    import EmailUpdateModal from "./EmailUpdateModal.svelte";

    // State for the dropdowns data
    /** @type {Record<string, string[]>} */
    let imagesData: Record<string, string[]> = {}; // Object with image names as keys and tag arrays as values
    /** @type {string[]} */
    let availableImages: string[] = []; // Array of image names
    let imagesLoading = true;

    // State for the file upload (will hold the ID when upload is done)
    /** @type {string | null} */
    let uploadedFileId: string | null = null;

    // State for the job execution
    let isJobRunning = false;
    let jobStatusMessage = "";
    /** @type {string | null} */
    let jobErrorMessage: string | null = null;
    /** @type {string | null} */
    let jobId: string | null = null;
    /**
     * Job id of an unfinished submission that blocked this one (from the 409's
     * `extra`), so the banner can link straight to it.
     * @type {string | null}
     */
    let blockingJobId: string | null = null;
    let statusBannerElement: HTMLElement | null = null;

    /**
     * Reports why the submission was rejected. The banner renders below the run
     * button, which on a long form can sit at the bottom of the viewport, so
     * scroll it into view -- otherwise clicking Run appears to do nothing, which
     * is the behaviour this validation exists to replace.
     */
    async function failValidation(message: string) {
        jobErrorMessage = message;
        await tick();
        statusBannerElement?.scrollIntoView({
            block: "center",
            behavior: "smooth",
        });
    }

    // State for email update modal
    let showEmailModal = false;

    // Flag to prevent saving during initial load
    let isInitializing = true;

    // Configuration entries array - each entry represents a config row
    /** @type {Array<{id: string, selectedImage: string | null, selectedTag: string | null, executionFileName: string, networkIsolation: boolean}>} */
    let configEntries: Array<{
        id: string;
        selectedImage: string | null;
        selectedTag: string | null;
        executionFileName: string;
        networkIsolation: boolean;
    }> = [
        {
            id: crypto.randomUUID(),
            selectedImage: null,
            selectedTag: null,
            executionFileName: "main.do",
            networkIsolation: false,
        },
    ];

    // Job-level secrets — in-memory only, never persisted to localStorage
    let jobSecrets: Record<string, string> = {};

    /**
     * The worker-size catalogue, and the rung this submission asks for.
     *
     * Workflow-level, deliberately: `pin_chain` binds every step of a
     * submission to one worker, so a per-stage size would be a promise the
     * platform cannot keep — and it would mean touching all six places the
     * configEntries shape is written out.
     *
     * `null` means "say nothing and take the server's default", which is what
     * every submission did before this control existed. It stays null when the
     * catalogue cannot be fetched, so a UI newer than its Girder degrades to
     * the old behaviour instead of guessing a number.
     * @type {WorkerSize[]}
     */
    let workerSizes: WorkerSize[] = [];
    /** @type {number | null} */
    let selectedMemoryGb: number | null = null;

    /**
     * Extra scratch disk for this submission, and what this caller may ask for.
     *
     * `requestedDiskGb` is `null` for *no volume*, which is the default for
     * every submission and is deliberately not `0`: absent is the only value the
     * server treats as "take the path with no Cinder call in it" (V1), so the
     * empty control has to send nothing rather than a zero.
     *
     * **Deliberately not remembered between submissions**, unlike the worker
     * size. A volume spends a scarce shared quota -- eight of them exist across
     * the whole deployment, and their gigabytes come out of the same reservation
     * as production's assetstore -- so a remembered 100 GB silently attached to
     * the next small submission is escalation by default. Asking for extra disk
     * stays a deliberate act each time, which is also what keeps "off by
     * default" true of the form and not just of the server.
     * @type {number | null}
     */
    let requestedDiskGb: number | null = null;
    /** @type {VolumeQuota | null} */
    let volumeQuota: VolumeQuota | null = null;

    // The control renders whenever the *deployment* offers volumes, including
    // for the common case of someone not approved for one -- disabled, and
    // labelled with how to ask (item 8). It advertises a capability most users
    // will never need, knowingly: the alternative is discovering it from an
    // out_of_disk failure after a long run, which is learning it the expensive
    // way. A deployment with the feature off shows nothing at all, because there
    // the answer is not "ask us" but "not here".
    $: showVolumeControl = volumeQuota?.enabled === true;
    // The most this caller could actually be granted: their own ceiling and the
    // deployment's reservation, whichever binds. 0 means the control is
    // read-only, for one of the two reasons below.
    $: volumeCeiling = volumeCeilingGb(volumeQuota);
    $: volumeAwaitingApproval = showVolumeControl && (volumeQuota?.max_gb ?? 0) <= 0;
    // Approved, but the deployment has nothing budgeted. A capacity state, not a
    // permissions one, and it has to read differently: telling an approved user
    // to request access sends them to ask for what they already have.
    $: volumeUnfunded =
        showVolumeControl &&
        (volumeQuota?.max_gb ?? 0) > 0 &&
        (volumeQuota?.deployment_gb ?? 0) <= 0;
    // What the server would actually create, which is a rounded-up multiple of
    // the granularity it reports. Shown whenever it differs from the request, so
    // the number in the form is never a surprise on the invoice.
    $: volumeGrantedGb =
        volumeQuota && requestedDiskGb !== null && requestedDiskGb > 0
            ? grantedVolumeGb(volumeQuota, requestedDiskGb)
            : null;
    // Live, so the reason appears while the number is still being typed rather
    // than only after a rejected submit.
    $: volumeProblem = volumeRefusal(volumeQuota, requestedDiskGb);

    /** How much of a rung's RAM the analysis actually gets, per S1 property 3. */
    const MEMORY_HEADROOM_GB = 2;
    /** Flat across the whole ladder: a bigger worker buys no more disk (D6). */
    const ROOT_DISK_GB = 60;

    $: gatedSizes = workerSizes.filter((size) => size.gated && !size.selectable);
    // The SU cost of a rung is its vCPU count on Jetstream2, and the ladder
    // doubles both together, so the ratio is the honest way to say "this one is
    // dearer" without printing a currency the user cannot check.
    $: costRatio =
        workerSizes.length > 1
            ? Math.round(
                  workerSizes[workerSizes.length - 1].vcpus /
                      workerSizes[0].vcpus,
              )
            : 1;

    /**
     * The label for one rung. The number *is* the class -- there is no
     * "standard"/"large" to look up -- and the usable figure keeps its `≈`
     * because it is advertised minus our own headroom only: the kernel also
     * reserves ~0.6-2 GiB, growing with the rung, so this overstates what the
     * container gets and must never read as exact.
     */
    function sizeLabel(size: WorkerSize): string {
        const usable = size.memory_gb - MEMORY_HEADROOM_GB;
        const cores = `${size.vcpus} core${size.vcpus === 1 ? "" : "s"}`;
        return (
            `${size.memory_gb} GiB · ${cores} — ≈${usable} GiB usable` +
            (size.gated && !size.selectable ? " (by request)" : "")
        );
    }

    /**
     * What the previous run's memory came to, handed down by JobMonitor, or null
     * when there is nothing to say (S5 guard 1).
     *
     * Best-effort by design: submissions are deleted on request and after the
     * retention window, a run can die before Docker emits a stats reading, and a
     * first-time user has no previous run at all. Every one of those is a normal
     * state, not an error, so the hint simply does not render.
     * @type {PreviousRunPeaks | null}
     */
    export let previousRun: PreviousRunPeaks | null = null;

    // Only meaningful against the cap that run was actually given: on a fleet
    // where the requested rung and the booted flavour can differ, a percentage
    // of what was *asked for* would be a different, less useful number.
    $: previousRunPercent =
        previousRun?.peakBytes && previousRun.limitBytes
            ? (previousRun.peakBytes / previousRun.limitBytes) * 100
            : null;
    // 85% is close enough that the next run's slightly larger dataset is the
    // one that gets OOM-killed; under 25% the rung below would have held it.
    // Only ever a suggestion: for MATLAB in particular the peak can land in a
    // stage other than the one that asked for the memory, because zeros() does
    // not commit until something writes (worker_sizing_plan.md item 11).
    $: previousRunAdvice =
        previousRunPercent === null
            ? null
            : previousRunPercent >= 85
              ? "That was close to the limit — the next size up may be safer."
              : previousRunPercent <= 25 &&
                  workerSizes.some(
                      (size) =>
                          size.selectable &&
                          selectedMemoryGb !== null &&
                          size.memory_gb < selectedMemoryGb,
                  )
                ? "A smaller size would have been enough."
                : null;

    /**
     * Roughly what a worker's own disk leaves for a workspace, in bytes.
     *
     * The root disk is ROOT_DISK_GB for every rung, of which the boot image and
     * the analysis image take a share that depends on the image -- a cold dynare
     * pull is ~15 GB, a Stata one under a gigabyte. So this is a *ceiling* on
     * what fits without a volume, not a promise, and it is only ever used to
     * decide whether to suggest asking for disk.
     */
    const ROOT_DISK_WORKSPACE_BYTES = 45 * 1024 ** 3;

    // The same evidence-led argument as the memory hint (S5 guard 1, C4): the
    // platform already measured the workspace this user's package grows, so the
    // form can say so instead of leaving them to guess a number of gigabytes.
    // Only a suggestion, and only when the measured peak is near what the root
    // disk could have held -- a run that peaked at a gigabyte needs no volume
    // and should not be nudged towards one.
    $: previousDiskAdvice =
        previousRun?.peakDiskBytes && previousRun.peakDiskBytes > ROOT_DISK_WORKSPACE_BYTES * 0.6
            ? "That is close to what a worker's own disk can hold — extra scratch disk may help."
            : null;

    const dispatch = createEventDispatcher();

    // Storage keys for persisting user preferences
    const STORAGE_KEYS = {
        configEntries: "sivacor_config_entries",
        // Its own key rather than a field on the config entries: the size is
        // workflow-level, and folding it into that array would mean migrating
        // every previously-saved value.
        memoryGb: "sivacor_worker_size",
    };

    /**
     * Save user selections to localStorage
     */
    function saveUserSelections() {
        try {
            // Save the entire config entries array
            // jobSecrets are intentionally omitted — never persist secrets to localStorage
            const configToSave = configEntries.map((entry) => ({
                selectedImage: entry.selectedImage,
                selectedTag: entry.selectedTag,
                executionFileName: entry.executionFileName,
                networkIsolation: entry.networkIsolation,
            }));
            localStorage.setItem(
                STORAGE_KEYS.configEntries,
                JSON.stringify(configToSave),
            );
        } catch (error) {
            console.warn(
                "Failed to save user selections to localStorage:",
                error,
            );
        }
    }

    /**
     * Load user selections from localStorage
     */
    function loadUserSelections() {
        try {
            const savedConfigData = localStorage.getItem(
                STORAGE_KEYS.configEntries,
            );
            if (savedConfigData) {
                const parsedConfigs = JSON.parse(savedConfigData);
                if (Array.isArray(parsedConfigs) && parsedConfigs.length > 0) {
                    // Restore config entries with validation
                    configEntries = parsedConfigs.map((config) => ({
                        id: crypto.randomUUID(), // Generate new IDs
                        selectedImage:
                            config.selectedImage &&
                            availableImages.includes(config.selectedImage)
                                ? config.selectedImage
                                : null,
                        selectedTag: config.selectedTag || null,
                        executionFileName:
                            config.executionFileName || "main.do",
                        networkIsolation: config.networkIsolation ?? false,
                    }));
                    console.log("Restored config entries:", configEntries);
                }
            } else {
                console.log("No saved config entries found in localStorage");
            }
        } catch (error) {
            console.warn(
                "Failed to load user selections from localStorage:",
                error,
            );
        }
    }

    /**
     * Fetches the size catalogue and settles on a rung.
     *
     * Non-fatal on purpose, and separate from the images fetch: a Girder that
     * predates the catalogue endpoint, or a transient failure, must not stop
     * the form working. The picker simply does not render, and the submission
     * takes the server's default -- exactly what happened before there was
     * anything to choose.
     */
    async function loadWorkerSizes() {
        try {
            const catalogue = await getWorkerSizes();
            workerSizes = catalogue.sizes;
            if (workerSizes.length === 0) {
                return;
            }
            const remembered = Number(
                localStorage.getItem(STORAGE_KEYS.memoryGb),
            );
            // Only honour a remembered size that is still on offer *to this
            // user*. A rung can be withdrawn from the catalogue, and group
            // membership can be lost, and in both cases the server would reject
            // the submission -- with a message about a size the user never
            // knowingly chose.
            const usable = workerSizes.some(
                (size) => size.memory_gb === remembered && size.selectable,
            );
            selectedMemoryGb = usable
                ? remembered
                : (catalogue.default ??
                  workerSizes.find((size) => size.selectable)?.memory_gb ??
                  null);
        } catch (error) {
            console.warn("Could not load worker sizes:", error);
        }
    }

    /**
     * Fetches this caller's scratch-volume allowance.
     *
     * Non-fatal and separate from everything else, for loadWorkerSizes' reason: a
     * Girder that predates the endpoint, or a transient failure, must leave a
     * working form behind. `volumeQuota` stays null, no control renders, and the
     * submission asks for no disk -- which is what every submission did before
     * this control existed.
     */
    async function loadVolumeQuota() {
        volumeQuota = await getVolumeQuota();
    }

    function saveWorkerSize() {
        try {
            localStorage.setItem(
                STORAGE_KEYS.memoryGb,
                String(selectedMemoryGb),
            );
        } catch (error) {
            console.warn("Failed to save the worker size:", error);
        }
    }

    // Reactive statements to save user selections when they change
    $: if (configEntries && configEntries.length > 0 && !isInitializing) {
        saveUserSelections();
    }

    $: if (selectedMemoryGb !== null && !isInitializing) {
        saveWorkerSize();
    }

    onMount(async () => {
        // Before the images, so `isInitializing` still covers it and settling
        // on a remembered rung does not immediately write it back. In parallel
        // with the quota: two independent reads of two different endpoints, and
        // neither can fail the other.
        await Promise.all([loadWorkerSizes(), loadVolumeQuota()]);
        try {
            imagesData = await getImages();
            availableImages = Object.keys(imagesData);

            if (availableImages.length > 0) {
                // Try to load saved selections first
                loadUserSelections();

                // If no entries were loaded, ensure we have at least one with a default image
                if (configEntries.length === 0) {
                    configEntries = [
                        {
                            id: crypto.randomUUID(),
                            selectedImage: availableImages[0],
                            selectedTag: null,
                            executionFileName: "main.do",
                            networkIsolation: false,
                        },
                    ];
                }

                // Set tags for entries that have images but no tags
                configEntries.forEach((entry) => {
                    if (
                        entry.selectedImage &&
                        imagesData[entry.selectedImage] &&
                        !entry.selectedTag
                    ) {
                        const availableTags = imagesData[entry.selectedImage];
                        if (availableTags.length > 0) {
                            entry.selectedTag = availableTags[0];
                        }
                    }
                });
                configEntries = [...configEntries]; // Trigger reactivity
            }
        } catch (error) {
            console.error("Failed to load available images:", error);
            // Extract detailed error message if available
            if (error instanceof Error) {
                jobErrorMessage = error.message;
            } else {
                jobErrorMessage = "Failed to load available images.";
            }
        } finally {
            imagesLoading = false;
            isInitializing = false; // Allow saving after initialization is complete
        }
    }); /**
     * Placeholder function for the FileUploader completion.
     * In a real implementation, FileUploader must be refactored to call this on success.
     * @param {CustomEvent<{fileId: string}>} event - Event containing the new file ID.
     */
    /**
     * @param {CustomEvent<{ fileId: string }>} event - The upload complete event
     */
    function handleUploadComplete(event: CustomEvent<{ fileId: string }>) {
        uploadedFileId = event.detail.fileId;
        jobStatusMessage = `File uploaded! ID: ${uploadedFileId}. Ready to run job.`;
    }

    /**
     * Clears the staged file once the uploader has deleted it. Without this the
     * form keeps the id of a file that no longer exists and submit fails with a
     * confusing server error instead of "Please upload a file first."
     */
    function handleUploadDeleted() {
        uploadedFileId = null;
        jobStatusMessage = "";
    }

    /**
     * Replaces the form's steps and secrets with an imported workflow
     * definition. WorkflowImport has already validated it against the schema
     * served by the backend and against the available images, so this only has
     * to translate the server's field names into the form's.
     *
     * Assigning configEntries goes through the same reactive save as a click or
     * a keystroke, so an imported workflow is cached in localStorage exactly
     * like a hand-filled one. Secrets follow the manual path too: in memory
     * only, never persisted.
     *
     * @param {CustomEvent<WorkflowDefinition>} event - The imported definition.
     */
    function handleWorkflowImport(event: CustomEvent<WorkflowDefinition>) {
        const definition = event.detail;
        configEntries = definition.stages.map((stage) => ({
            id: crypto.randomUUID(),
            selectedImage: stage.image_name,
            selectedTag: stage.image_tag,
            executionFileName: stage.main_file,
            networkIsolation: stage.network_isolation ?? false,
        }));
        jobSecrets = Object.fromEntries(
            (definition.env_secrets ?? []).map(({ key, value }) => [key, value]),
        );
        // WorkflowImport has already checked the requested rung against the
        // catalogue, so anything that arrives here is selectable. A file with no
        // `resources` block -- every workflow exported before this shipped --
        // leaves the current choice alone rather than resetting it: it asked for
        // nothing, so it says nothing about the size.
        if (typeof definition.resources?.memory_gb === "number") {
            selectedMemoryGb = definition.resources.memory_gb;
        }
        // Same rule for disk, and the same reason for the asymmetry: WorkflowImport
        // has already checked the request against this caller's own allowance, so
        // anything arriving here is grantable. A file with no `disk_gb` leaves the
        // field alone rather than clearing it -- it asked for nothing, so it says
        // nothing about the disk.
        if (typeof definition.resources?.disk_gb === "number") {
            requestedDiskGb = definition.resources.disk_gb;
        }
        // A stale banner from an earlier attempt would otherwise sit under the
        // run button describing a form that no longer exists.
        jobErrorMessage = null;
        blockingJobId = null;
    }

    /**
     * Add a new configuration entry
     */
    function addConfigEntry() {
        configEntries = [
            ...configEntries,
            {
                id: crypto.randomUUID(),
                selectedImage: null,
                selectedTag: null,
                executionFileName: "main.do",
                networkIsolation: false,
            },
        ];
        // Saving will be triggered by the reactive statement
    }

    /**
     * Remove a configuration entry
     * @param {string} entryId - The ID of the entry to remove
     */
    function removeConfigEntry(entryId: string) {
        // Always keep at least one entry
        if (configEntries.length > 1) {
            configEntries = configEntries.filter(
                (entry) => entry.id !== entryId,
            );
            // Saving will be triggered by the reactive statement
        }
    }

    /**
     * Update available tags for a specific config entry when its image selection changes
     * @param {string} entryId - The ID of the entry
     * @param {string | null} selectedImage - The selected image
     */
    function updateEntryTags(entryId: string, selectedImage: string) {
        const entry = configEntries.find((e) => e.id === entryId);
        if (entry && selectedImage && imagesData[selectedImage]) {
            const availableTagsForImage = imagesData[selectedImage];

            // If current tag is not valid for this image, reset to first available
            if (
                !entry.selectedTag ||
                !availableTagsForImage.includes(entry.selectedTag)
            ) {
                entry.selectedTag = availableTagsForImage[0] || null;
                configEntries = [...configEntries]; // Trigger reactivity and save
            }
        }
    }

    /**
     * Job-level secret helpers.
     * Secrets are kept only in component memory — never persisted to localStorage.
     */
    function addSecret() {
        jobSecrets = { ...jobSecrets, "": "" };
    }

    function updateSecretKey(oldKey: string, newKey: string) {
        const updated: Record<string, string> = {};
        for (const [k, v] of Object.entries(jobSecrets)) {
            updated[k === oldKey ? newKey : k] = v;
        }
        jobSecrets = updated;
    }

    function updateSecretValue(key: string, value: string) {
        jobSecrets = { ...jobSecrets, [key]: value };
    }

    function removeSecret(key: string) {
        const rest = { ...jobSecrets };
        delete rest[key];
        jobSecrets = rest;
    }

    async function runJob() {
        // Clear the previous attempt's banner up front. The guards below only
        // set jobErrorMessage, so without this a stale success message would
        // linger underneath an error icon.
        jobErrorMessage = null;
        jobStatusMessage = "";
        blockingJobId = null;

        if ($hasInvalidOrcidEmail) {
            await failValidation(
                "Your ORCID account does not have a valid public email " +
                    "address. Please update your email before submitting.",
            );
            return;
        }

        if (!uploadedFileId) {
            await failValidation("Please upload a file first.");
            return;
        }

        const firstEntry = configEntries[0];
        if (!firstEntry) {
            await failValidation("No configuration available.");
            return;
        }

        // Every step, not just the first: incomplete later steps used to be
        // dropped silently by the filter below, so a half-filled step 2 was
        // submitted as a one-step workflow without a word to the user.
        for (const [index, entry] of configEntries.entries()) {
            // Only name the step when there is more than one to disambiguate.
            const step = configEntries.length > 1 ? `Step ${index + 1}: ` : "";
            if (!entry.executionFileName.trim()) {
                await failValidation(
                    `${step}Please specify an execution file name.`,
                );
                return;
            }
            if (!entry.selectedImage || !entry.selectedTag) {
                await failValidation(
                    `${step}Please select both an image and a tag.`,
                );
                return;
            }
        }

        // Last, because it is the only guard whose answer depends on a server
        // fetch: a quota that failed to load leaves volumeProblem null and the
        // server rules on the request instead, which is the same outcome as
        // before this control existed.
        if (volumeProblem) {
            await failValidation(volumeProblem);
            return;
        }

        isJobRunning = true;
        const fullImageName = `${firstEntry.selectedImage}:${firstEntry.selectedTag}`;
        jobStatusMessage = `Starting job for image: ${fullImageName} with file: ${firstEntry.executionFileName}...`;

        try {
            // Submit every step: the loop above proved they are all complete,
            // so there is nothing left to filter out.
            const validConfig = configEntries as Array<{
                id: string;
                selectedImage: string;
                selectedTag: string;
                executionFileName: string;
                networkIsolation: boolean;
            }>;

            const response = await submitJob(
                uploadedFileId,
                validConfig,
                jobSecrets,
                selectedMemoryGb,
                requestedDiskGb,
            );
            jobId = response._id || "N/A";
            jobStatusMessage = `Job successfully started! Job ID: ${jobId}`;
            dispatch("jobsubmitted", {
                jobId: jobId,
                executionFile: firstEntry.executionFileName,
                image: firstEntry.selectedImage,
                tag: firstEntry.selectedTag,
                fullImage: fullImageName,
            });
        } catch (error) {
            console.error("Job submission failed:", error);
            // Extract detailed error message if available
            if (error instanceof Error) {
                jobErrorMessage = error.message;
            } else {
                jobErrorMessage =
                    "Failed to submit job. Check console for details.";
            }
            // A 409 means an earlier submission of ours is still unfinished;
            // the server puts its job id in `extra` so we can link to it.
            const apiError = error as ApiError;
            if (apiError?.statusCode === 409 && apiError.details?.extra) {
                blockingJobId = apiError.details.extra;
            }
            // No "Job submission failed." heading: the banner is already red
            // and carries an error icon, and jobErrorMessage below says what
            // actually went wrong. Clear the "Starting job..." message so it
            // cannot be mistaken for the outcome.
            jobStatusMessage = "";
            await tick();
            statusBannerElement?.scrollIntoView({
                block: "center",
                behavior: "smooth",
            });
        } finally {
            isJobRunning = false;
        }
    }
</script>

<div class="job-runner-container md-card">
    <div class="runner-header">
        <div class="header-title">
            <span class="material-icons runner-icon">play_circle</span>
            <h3>New Submission</h3>
        </div>
        <p class="runner-description">
            Upload a file, select Docker image and tag, then specify your main
            execution file — or import the whole workflow from a YAML/JSON file.
        </p>
    </div>

    <div class="runner-content">
        <FileUploader
            on:uploadcomplete={handleUploadComplete}
            on:uploaddeleted={handleUploadDeleted}
        />

        <div class="config-section">
            <WorkflowImport
                {imagesData}
                {workerSizes}
                {volumeQuota}
                disabled={isJobRunning}
                on:import={handleWorkflowImport}
            />

            {#each configEntries as entry, index (entry.id)}
                <div class="config-row">
                    <div class="step-badge">{index + 1}</div>
                    <div class="config-widgets">
                        <!-- Docker Image Selection -->
                        <div class="input-group">
                            <label for="image-select-{entry.id}">
                                Docker Image
                            </label>
                            {#if imagesLoading}
                                <div class="loading-state">
                                    <div class="md-spinner"></div>
                                    <span>Loading...</span>
                                </div>
                            {:else if availableImages.length > 0}
                                <select
                                    id="image-select-{entry.id}"
                                    bind:value={entry.selectedImage}
                                    on:change={() =>
                                        entry.selectedImage &&
                                        updateEntryTags(
                                            entry.id,
                                            entry.selectedImage,
                                        )}
                                    disabled={isJobRunning}
                                >
                                    <option value={null}>Select Image</option>
                                    {#each availableImages as image (image)}
                                        <option value={image}>{image}</option>
                                    {/each}
                                </select>
                            {:else}
                                <div class="error-state">
                                    <span class="material-icons">warning</span>
                                    <span>No images available</span>
                                </div>
                            {/if}
                        </div>

                        <!-- Image Tag Selection -->
                        <div class="input-group">
                            <label for="tag-select-{entry.id}">
                                Image Tag
                            </label>
                            {#if imagesLoading}
                                <div class="loading-state">
                                    <div class="md-spinner"></div>
                                    <span>Loading...</span>
                                </div>
                            {:else if entry.selectedImage && imagesData[entry.selectedImage]?.length > 0}
                                <select
                                    id="tag-select-{entry.id}"
                                    bind:value={entry.selectedTag}
                                    disabled={isJobRunning ||
                                        !entry.selectedImage}
                                >
                                    {#each imagesData[entry.selectedImage] as tag (tag)}
                                        <option value={tag}>{tag}</option>
                                    {/each}
                                </select>
                            {:else if entry.selectedImage}
                                <div class="error-state">
                                    <span class="material-icons">warning</span>
                                    <span>No tags available</span>
                                </div>
                            {:else}
                                <select disabled class="disabled-select">
                                    <option>Select an image first</option>
                                </select>
                            {/if}
                        </div>

                        <!-- Main Filename -->
                        <div class="input-group">
                            <label for="execution-file-{entry.id}">
                                Main Filename
                            </label>
                            <input
                                type="text"
                                id="execution-file-{entry.id}"
                                bind:value={entry.executionFileName}
                                disabled={isJobRunning}
                                placeholder="e.g., main.do, main.R"
                                class="file-input"
                            />
                            <div class="input-hint">
                                💡 Common: <code>main.do</code> (Stata),
                                <code>main.R</code> (R)
                            </div>
                        </div>

                        <!-- Internet Isolation Toggle -->
                        <div class="input-group toggle-group">
                            <label for="isolation-toggle-{index}">
                                Net Isolation
                            </label>
                            <label class="toggle-switch">
                                <input
                                    type="checkbox"
                                    id="isolation-toggle-{entry.id}"
                                    bind:checked={entry.networkIsolation}
                                    disabled={isJobRunning}
                                    aria-describedby="isolation-hint-{index}"
                                />
                                <span class="toggle-slider" aria-hidden="true"
                                ></span>
                            </label>
                            <div class="input-hint" id="isolation-hint-{index}">
                                Block network access<br />during execution
                            </div>
                        </div>
                    </div>

                    <!-- Remove button (only show if more than one entry) -->
                    {#if configEntries.length > 1}
                        <button
                            type="button"
                            class="remove-config-btn"
                            on:click={() => removeConfigEntry(entry.id)}
                            disabled={isJobRunning}
                            title="Remove this configuration"
                        >
                            <span class="material-icons">remove</span>
                        </button>
                    {/if}
                </div>
            {/each}

            <!-- Add button -->
            <button
                type="button"
                class="add-config-btn"
                on:click={addConfigEntry}
                disabled={isJobRunning}
            >
                <span class="material-icons">add</span>
                Add Step
            </button>

            <!-- Worker size. Workflow-level, like the secrets below it: every
                 step of a submission runs on one machine, so this cannot sit in
                 a per-stage row without promising something untrue. Rendered
                 only once the catalogue is known -- with none, the server picks,
                 which is what it did before this control existed. -->
            {#if workerSizes.length > 0}
                <div
                    class="resources-section"
                    role="group"
                    aria-labelledby="resources-section-title"
                >
                    <div class="resources-header">
                        <span
                            class="material-icons resources-icon"
                            aria-hidden="true">memory</span
                        >
                        <span
                            class="resources-label"
                            id="resources-section-title">Worker Size (RAM · CPU)</span
                        >
                        <span class="resources-hint">Applies to all steps</span>
                    </div>
                    <div class="resources-body">
                        <label for="worker-size-select" class="sr-only">
                            Memory and cores for this submission
                        </label>
                        <select
                            id="worker-size-select"
                            bind:value={selectedMemoryGb}
                            disabled={isJobRunning}
                            aria-describedby="worker-size-hint"
                        >
                            <!-- Gated rungs are shown disabled rather than
                                 hidden: a researcher who needs one has to be
                                 able to see that it exists and how to ask. -->
                            {#each workerSizes as size (size.memory_gb)}
                                <option
                                    value={size.memory_gb}
                                    disabled={!size.selectable}
                                >
                                    {sizeLabel(size)}
                                </option>
                            {/each}
                        </select>
                        <div class="input-hint" id="worker-size-hint">
                            Every size gets the same {ROOT_DISK_GB} GB of disk.
                            {#if costRatio > 1}
                                The largest costs about {costRatio}× the
                                smallest, so pick the smallest that fits.
                            {/if}
                            {#if gatedSizes.length > 0}
                                Sizes marked <em>(by request)</em> need
                                approval: email
                                <a href="mailto:support@sivacor.org"
                                    >support@sivacor.org</a
                                >.
                            {/if}
                        </div>
                        <!-- S5 guard 1: the choice should be evidence-led, and
                             the platform already measured the evidence. Absent
                             far more often than not -- no previous run, or one
                             already deleted -- so it is additive, never a gap
                             in the layout. -->
                        {#if previousRun && previousRun.peakBytes !== null}
                            <!-- id, not just the class: there are now two of
                                 these notes on the form, one per resource, and
                                 `.previous-run` no longer identifies either. -->
                            <div
                                class="input-hint previous-run"
                                id="previous-run-memory"
                                role="note"
                            >
                                <span
                                    class="material-icons hint-icon"
                                    aria-hidden="true">history</span
                                >
                                <span>
                                    Your last run peaked at
                                    <strong
                                        >{formatBytes(
                                            previousRun.peakBytes ?? undefined,
                                        )}</strong
                                    >
                                    {#if previousRunPercent !== null}
                                        of the {formatBytes(
                                            previousRun.limitBytes ?? undefined,
                                        )} it was allowed ({previousRunPercent <
                                        1
                                            ? "<1"
                                            : Math.round(
                                                  previousRunPercent,
                                              )}%).
                                    {:else}
                                        <!-- A standalone sentence, not a
                                             continuation: the whitespace
                                             between markup nodes renders as a
                                             space, so a leading comma here
                                             comes out as "42.68 MB , which". -->
                                        and was not capped.
                                    {/if}
                                    {previousRunAdvice ?? ""}
                                </span>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}

            <!-- Extra scratch disk. Its own section rather than a second field
                 in the one above, so the two degrade independently: either
                 endpoint can be missing or fail, and a form that loses the size
                 catalogue must still be able to offer disk (and the reverse).
                 Rendered only where the deployment offers volumes at all --
                 where it does not, the answer is "not here" rather than "ask
                 us", and a disabled control would say the wrong one. -->
            {#if showVolumeControl}
                <div
                    class="resources-section"
                    role="group"
                    aria-labelledby="scratch-disk-section-title"
                >
                    <div class="resources-header">
                        <span
                            class="material-icons resources-icon"
                            aria-hidden="true">storage</span
                        >
                        <span
                            class="resources-label"
                            id="scratch-disk-section-title"
                        >
                            Extra Scratch Disk{volumeAwaitingApproval
                                ? " (by request)"
                                : ""}
                        </span>
                        <span class="resources-hint">Applies to all steps</span>
                    </div>
                    <div class="resources-body">
                        <label for="scratch-disk-input" class="sr-only">
                            Extra scratch disk for this submission, in GB
                        </label>
                        <input
                            id="scratch-disk-input"
                            class="disk-input"
                            type="number"
                            inputmode="numeric"
                            bind:value={requestedDiskGb}
                            min={volumeQuota?.granularity_gb ?? 1}
                            max={volumeCeiling || undefined}
                            step={volumeQuota?.granularity_gb ?? 1}
                            placeholder="None"
                            disabled={isJobRunning || volumeCeiling === 0}
                            aria-describedby="scratch-disk-hint"
                            aria-invalid={volumeProblem !== null}
                        />
                        <span class="disk-unit" aria-hidden="true">GB</span>
                        <div class="input-hint" id="scratch-disk-hint">
                            {#if volumeAwaitingApproval}
                                A scratch volume for submissions whose data will
                                not fit a worker's own disk. It needs approval
                                per account: email
                                <a href="mailto:support@sivacor.org"
                                    >support@sivacor.org</a
                                >, saying roughly how much space your package
                                needs.
                            {:else if volumeUnfunded}
                                Approved for your account, but this deployment
                                has no space budgeted for it right now. Contact
                                <a href="mailto:support@sivacor.org"
                                    >support@sivacor.org</a
                                >.
                            {:else}
                                Leave empty to use the worker's own {ROOT_DISK_GB}
                                GB disk, which the analysis image shares. You may
                                ask for up to {volumeCeiling} GB, rounded up to
                                the nearest {volumeQuota?.granularity_gb} GB, and
                                it is wiped when the run finishes.
                            {/if}
                        </div>
                        <!-- The rounded figure, whenever it is not the one that
                             was typed: the server rounds *before* checking the
                             ceiling, so a researcher who asks for 95 against a
                             100 GB allowance should see 100 here rather than
                             discover it later. -->
                        {#if volumeGrantedGb !== null && volumeGrantedGb !== requestedDiskGb && volumeProblem === null}
                            <div class="input-hint" role="status">
                                Rounds up to <strong>{volumeGrantedGb} GB</strong
                                >.
                            </div>
                        {/if}
                        {#if volumeProblem}
                            <div class="input-hint disk-problem" role="alert">
                                <span
                                    class="material-icons hint-icon"
                                    aria-hidden="true">error_outline</span
                                >
                                <span>{volumeProblem}</span>
                            </div>
                        {/if}
                        <!-- The same evidence-led hint the size picker gets, and
                             for the same reason: the platform measured the
                             workspace this package grows, so the choice can be
                             led by that instead of by guesswork. Absent far more
                             often than not. -->
                        {#if previousRun && previousRun.peakDiskBytes !== null}
                            <div
                                class="input-hint previous-run"
                                id="previous-run-disk"
                                role="note"
                            >
                                <span
                                    class="material-icons hint-icon"
                                    aria-hidden="true">history</span
                                >
                                <span>
                                    Your last run's workspace peaked at
                                    <strong
                                        >{formatBytes(
                                            previousRun.peakDiskBytes ??
                                                undefined,
                                        )}</strong
                                    >.
                                    {previousDiskAdvice ?? ""}
                                </span>
                            </div>
                        {/if}
                    </div>
                </div>
            {/if}

            <!-- Job-level Environment Secrets (in-memory only, never persisted) -->
            <div
                class="secrets-section"
                role="group"
                aria-labelledby="secrets-section-title"
            >
                <div class="secrets-header">
                    <span class="material-icons secrets-icon" aria-hidden="true"
                        >lock</span
                    >
                    <span class="secrets-label" id="secrets-section-title"
                        >Environment Secrets</span
                    >
                    <span class="secrets-hint" id="secrets-section-hint"
                        >Passed to all stages</span
                    >
                    <button
                        type="button"
                        class="add-secret-btn"
                        on:click={addSecret}
                        disabled={isJobRunning}
                        aria-label="Add environment variable"
                        title="Add secret environment variable"
                    >
                        <span class="material-icons" aria-hidden="true"
                            >add</span
                        >
                    </button>
                </div>
                <!-- Keyed by the variable name, which is unique by construction
                     (it is an object key). Safe despite renames re-keying the
                     row, because the name is committed on change -- i.e. on
                     blur -- not on every keystroke. -->
                {#each Object.entries(jobSecrets) as [key, value] (key)}
                    <div class="secret-row">
                        <label for="secret-key-{key}" class="sr-only">
                            Environment variable name
                        </label>
                        <input
                            id="secret-key-{key}"
                            type="text"
                            class="secret-key-input"
                            placeholder="VAR_NAME"
                            value={key}
                            on:change={(e) =>
                                updateSecretKey(
                                    key,
                                    (e.target as HTMLInputElement).value,
                                )}
                            disabled={isJobRunning}
                            autocomplete="off"
                            spellcheck={false}
                            aria-label="Environment variable name"
                        />
                        <span class="secret-separator" aria-hidden="true"
                            >=</span
                        >
                        <label for="secret-value-{key}" class="sr-only">
                            Environment variable value
                        </label>
                        <input
                            id="secret-value-{key}"
                            type="password"
                            class="secret-value-input"
                            placeholder="secret value"
                            {value}
                            on:input={(e) =>
                                updateSecretValue(
                                    key,
                                    (e.target as HTMLInputElement).value,
                                )}
                            disabled={isJobRunning}
                            autocomplete="new-password"
                            aria-label="Environment variable value"
                        />
                        <button
                            type="button"
                            class="remove-secret-btn"
                            on:click={() => removeSecret(key)}
                            disabled={isJobRunning}
                            aria-label="Remove environment variable {key}"
                            title="Remove secret"
                        >
                            <span class="material-icons" aria-hidden="true"
                                >close</span
                            >
                        </button>
                    </div>
                {/each}
            </div>

            <!-- Only disabled while a submission is in flight, to stop a double
                 submit. Everything else is validated in runJob() on click, so an
                 incomplete form says what is missing instead of leaving the user
                 with a dead button and no explanation. -->
            <button
                on:click={runJob}
                disabled={isJobRunning}
                class="run-button"
                class:running={isJobRunning}
            >
                {#if isJobRunning}
                    <div class="md-spinner"></div>
                    Processing...
                {:else}
                    <span class="material-icons">play_arrow</span>
                    Run Replication Workflow
                {/if}
            </button>
            {#if $hasInvalidOrcidEmail}
                <div class="email-warning">
                    <span class="material-icons warning-icon">warning</span>
                    <div class="warning-text">
                        <strong>Action Required:</strong> Your ORCID account
                        does not have a valid public email address. Please
                        update your email:
                        <div class="warning-actions">
                            <button
                                type="button"
                                class="update-email-btn"
                                on:click={() => (showEmailModal = true)}
                            >
                                <span class="material-icons">edit</span>
                                Update Email Here
                            </button>
                            <span class="separator">or</span>
                            <a
                                href="https://orcid.org/my-orcid"
                                target="_blank"
                                rel="noopener noreferrer"
                                class="orcid-link"
                            >
                                <span class="material-icons">open_in_new</span>
                                Make Email Public at ORCiD.org
                            </a>
                            (after changing at ORCiD.org, you will need to relogin)
                        </div>
                    </div>
                </div>
            {/if}
        </div>

        {#if jobStatusMessage || jobErrorMessage}
            <div
                class="status-banner"
                class:error={jobErrorMessage}
                class:success={!jobErrorMessage}
                role={jobErrorMessage ? "alert" : "status"}
                bind:this={statusBannerElement}
            >
                <span class="material-icons status-icon">
                    {jobErrorMessage ? "error" : "check_circle"}
                </span>
                <div class="status-content">
                    {#if jobErrorMessage}
                        <div class="status-message">{jobErrorMessage}</div>
                        {#if blockingJobId}
                            <!-- data-sveltekit-reload: this navigates within
                                 the same route, so a client-side navigation
                                 would leave JobMonitor mounted and never re-run
                                 its onMount recovery. -->
                            <a
                                class="blocking-job-link"
                                href="/?jobId={blockingJobId}"
                                data-sveltekit-reload
                            >
                                <span class="material-icons">open_in_new</span>
                                Go to your submission in progress
                            </a>
                        {/if}
                    {:else}
                        <div class="status-message">{jobStatusMessage}</div>
                        {#if jobId}
                            <div class="job-id">Job ID: {jobId}</div>
                        {/if}
                    {/if}
                </div>
            </div>
        {/if}
    </div>
</div>
<EmailUpdateModal
    bind:show={showEmailModal}
    currentEmail={$user?.email || ""}
/>

<style>
    .job-runner-container {
        margin-bottom: var(--md-spacing-lg);
    }

    .runner-header {
        margin-bottom: var(--md-spacing-md);
    }

    .header-title {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-xs);
    }

    .runner-icon {
        font-size: 1.5rem;
        color: var(--md-primary);
    }

    .runner-header h3 {
        margin: 0;
        color: var(--md-on-surface);
        font-size: 1.25rem;
    }

    .runner-description {
        color: var(--md-on-surface-variant);
        font-size: var(--md-font-caption);
        margin: 0;
        padding-left: calc(1.5rem + var(--md-spacing-sm));
    }

    .runner-content {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .config-section {
        display: flex;
        flex-direction: column;
        gap: var(--md-spacing-md);
    }

    .config-row {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 1px solid var(--md-outline-variant);
        border-radius: var(--md-radius-md);
        background: var(--md-surface-container-lowest);
    }

    .step-badge {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 28px;
        background: var(--md-primary);
        color: white;
        border-radius: 50%;
        font-size: 0.875rem;
        font-weight: 600;
        flex-shrink: 0;
    }

    .config-widgets {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr 100px;
        gap: var(--md-spacing-sm);
        flex: 1;
        align-items: start;
    }

    .input-group {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0; /* Allow shrinking */
    }

    .input-group label {
        font-weight: 500;
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .loading-state {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm);
        background-color: var(--md-surface-variant);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
    }

    .error-state {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm);
        background-color: rgba(244, 67, 54, 0.1);
        color: var(--md-error);
        border: 1px solid rgba(244, 67, 54, 0.3);
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-caption);
    }

    select {
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%204%205'%3E%3Cpath%20fill='%23666'%20d='M2%200L0%202h4zm0%205L0%203h4z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        padding: var(--md-spacing-sm);
        padding-right: 40px;
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        background-color: var(--md-surface);
        color: var(--md-on-surface);
        font-size: var(--md-font-body2);
        transition: border-color var(--md-transition-standard);
    }

    select:focus {
        outline: none;
        border-color: var(--md-primary);
    }

    select:disabled {
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
    }

    .disabled-select {
        appearance: none;
        background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%204%205'%3E%3Cpath%20fill='%23999'%20d='M2%200L0%202h4zm0%205L0%203h4z'/%3E%3C/svg%3E");
        background-repeat: no-repeat;
        background-position: right 12px center;
        background-size: 12px;
        padding: var(--md-spacing-sm);
        padding-right: 40px;
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
        font-size: var(--md-font-body2);
    }

    .file-input {
        padding: var(--md-spacing-sm);
        border: 2px solid var(--md-outline-variant);
        border-radius: var(--md-radius-xs);
        background-color: var(--md-surface);
        color: var(--md-on-surface);
        font-size: var(--md-font-body2);
        transition: border-color var(--md-transition-standard);
    }

    .file-input:focus {
        outline: none;
        border-color: var(--md-primary);
    }

    .file-input:disabled {
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
    }

    .input-hint {
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
        margin: -12px 0 0 0;
        line-height: 1.2;
    }

    .input-hint code {
        background-color: var(--md-surface-variant);
        padding: 2px 6px;
        border-radius: var(--md-radius-xs);
        font-family: "Courier New", monospace;
        font-size: 0.875em;
        color: var(--md-on-surface);
    }

    .toggle-group {
        width: 100px;
        justify-content: flex-start;
    }

    .toggle-group .input-hint {
        margin: 0;
    }

    .toggle-switch {
        position: relative;
        display: inline-block;
        width: 44px;
        height: 24px;
        cursor: pointer;
        flex-shrink: 0;
    }

    .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
        position: absolute;
    }

    .toggle-slider {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: var(--md-outline-variant);
        border-radius: 24px;
        transition: background-color var(--md-transition-standard);
    }

    .toggle-slider::before {
        content: "";
        position: absolute;
        height: 18px;
        width: 18px;
        left: 3px;
        bottom: 3px;
        background-color: white;
        border-radius: 50%;
        transition: transform var(--md-transition-standard);
    }

    .toggle-switch input:checked + .toggle-slider {
        background-color: var(--md-primary);
    }

    .toggle-switch input:checked + .toggle-slider::before {
        transform: translateX(20px);
    }

    .toggle-switch input:disabled + .toggle-slider {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .toggle-switch:focus-within .toggle-slider {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
    }

    .run-button {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background-color: var(--md-success);
        color: white;
        font-size: var(--md-font-body2);
        font-weight: 500;
        min-height: 44px;
        transition: all var(--md-transition-standard);
    }

    .run-button:hover:not(:disabled) {
        background-color: #45a049;
        box-shadow: var(--md-elevation-3);
        transform: translateY(-1px);
    }

    .run-button:active:not(:disabled) {
        transform: translateY(0);
    }

    .run-button.running {
        background-color: var(--md-warning);
    }

    .run-button:disabled {
        background-color: var(--md-outline-variant) !important;
        color: var(--md-on-surface-variant) !important;
        transform: none !important;
    }

    .run-button:focus-visible {
        outline: 3px solid var(--md-success);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(48, 110, 52, 0.3);
    }

    .email-warning {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-md);
        background: #fff3cd;
        border: 1px solid #ffc107;
        border-radius: var(--md-radius-xs);
        margin-top: var(--md-spacing-md);
        color: #856404;
    }

    .warning-icon {
        color: #d84315;
        flex-shrink: 0;
    }

    .warning-text {
        font-size: var(--md-font-body2);
        line-height: 1.5;
        flex: 1;
    }

    .warning-text strong {
        display: block;
        margin-bottom: var(--md-spacing-sm);
    }

    .warning-actions {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-top: var(--md-spacing-sm);
    }

    .update-email-btn {
        display: inline-flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-xs) var(--md-spacing-md);
        background: var(--md-primary);
        color: white;
        border: none;
        border-radius: var(--md-radius-xs);
        font-size: var(--md-font-body2);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
    }

    .update-email-btn:hover {
        background: var(--md-primary-dark);
        box-shadow: var(--md-shadow-sm);
    }

    .update-email-btn:focus-visible {
        outline: 3px solid var(--md-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(25, 118, 210, 0.3);
    }

    .update-email-btn .material-icons {
        font-size: 18px;
    }

    .separator {
        color: #856404;
        font-weight: 500;
        padding: 0 var(--md-spacing-xs);
    }

    .orcid-link {
        display: inline-flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        color: #0056b3;
        text-decoration: none;
        font-weight: 500;
        padding: var(--md-spacing-xs) var(--md-spacing-sm);
        border-radius: var(--md-radius-xs);
        transition: all 0.2s ease;
    }

    .orcid-link:hover {
        background: rgba(0, 86, 179, 0.1);
        text-decoration: underline;
    }

    .orcid-link:focus-visible {
        outline: 3px solid #0056b3;
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(0, 86, 179, 0.2);
    }

    .orcid-link .material-icons {
        font-size: 18px;
    }

    .add-config-btn {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        background: var(--md-secondary-container);
        color: var(--md-on-secondary-container);
        border: none;
        border-radius: var(--md-radius-full);
        font-size: var(--md-font-body2);
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s ease;
        align-self: flex-start;
    }

    .add-config-btn:hover:not(:disabled) {
        background: var(--md-secondary-container);
        box-shadow: var(--md-elevation-1);
        transform: translateY(-1px);
    }

    .add-config-btn:active:not(:disabled) {
        transform: translateY(0);
        box-shadow: none;
    }

    .add-config-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .add-config-btn:focus-visible {
        outline: 3px solid var(--md-secondary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(3, 218, 198, 0.3);
    }

    .remove-config-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        background: var(--md-error-container);
        color: var(--md-on-error-container);
        border: none;
        border-radius: var(--md-radius-full);
        cursor: pointer;
        transition: all 0.2s ease;
        flex-shrink: 0;
    }

    .remove-config-btn:hover:not(:disabled) {
        background: var(--md-error);
        color: var(--md-on-error);
        transform: scale(1.1);
    }

    .remove-config-btn:active:not(:disabled) {
        transform: scale(0.95);
    }

    .remove-config-btn:focus-visible {
        outline: 3px solid var(--md-error);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px rgba(244, 67, 54, 0.3);
    }

    .remove-config-btn:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .status-banner {
        display: flex;
        align-items: flex-start;
        gap: var(--md-spacing-sm);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border-radius: var(--md-radius-sm);
        animation: slideIn 0.3s ease-out;
    }

    .status-banner.success {
        background-color: rgba(76, 175, 80, 0.1);
        border: 1px solid rgba(76, 175, 80, 0.3);
        color: var(--md-success);
    }

    .status-banner.error {
        background-color: rgba(244, 67, 54, 0.1);
        border: 1px solid rgba(244, 67, 54, 0.3);
        color: var(--md-error);
    }

    .status-icon {
        font-size: 1.25rem;
        margin-top: 2px;
    }

    .status-content {
        flex: 1;
    }

    .status-message {
        font-weight: 500;
        font-size: var(--md-font-body2);
        line-height: 1.3;
    }

    .job-id {
        font-size: var(--md-font-caption);
        opacity: 0.8;
        font-family: "Courier New", monospace;
        margin-top: 4px;
    }

    .blocking-job-link {
        display: inline-flex;
        align-items: center;
        gap: var(--md-spacing-xs);
        margin-top: var(--md-spacing-xs);
        color: inherit;
        font-size: var(--md-font-body2);
        font-weight: 500;
    }

    .blocking-job-link .material-icons {
        font-size: 1rem;
    }

    .blocking-job-link:focus-visible {
        outline: 3px solid currentColor;
        outline-offset: 2px;
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    @media (max-width: 768px) {
        .header-title {
            flex-direction: row;
        }

        .run-button {
            padding: var(--md-spacing-md);
            font-size: var(--md-font-body2);
        }

        .status-banner {
            flex-direction: column;
            text-align: center;
        }

        .config-widgets {
            grid-template-columns: 1fr;
            gap: var(--md-spacing-sm);
        }

        .config-row {
            flex-direction: column;
            gap: var(--md-spacing-sm);
        }

        .remove-config-btn {
            align-self: center;
            margin-top: var(--md-spacing-sm);
        }
    }

    /* Secrets section */
    /* Same frame as .secrets-section: both are workflow-level panels sitting
       below the per-step rows, and they should read as one pair rather than as
       two unrelated boxes. */
    .resources-section {
        margin-top: var(--md-spacing-md);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 1px solid var(--md-outline-variant, #cac4d0);
        border-radius: var(--md-shape-corner-small, 4px);
        background: var(--md-surface-variant, #f3edf7);
    }

    .resources-header {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-sm);
    }

    .resources-icon {
        font-size: 1rem;
        color: var(--md-primary-dark, #1565c0);
    }

    .resources-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--md-on-surface, #1c1b1f);
    }

    .resources-hint {
        font-size: 0.75rem;
        color: var(--md-on-surface-variant, #49454f);
        flex: 1;
    }

    .resources-body select {
        width: 100%;
        max-width: 28rem;
    }

    /* .input-hint's -12px top margin exists to close the gap in .input-group's
       flex column; here there is no gap to close, and it would drag the hint
       over the select. */
    .resources-body .input-hint {
        margin: var(--md-spacing-sm) 0 0 0;
    }

    /* Narrow, and inline with its unit: a disk request is two or three digits,
       and a full-width field would read as though a path or a filename belonged
       in it. */
    .disk-input {
        width: 7rem;
        padding: var(--md-spacing-sm);
        border: 1px solid var(--md-outline, #79747e);
        border-radius: var(--md-radius-xs, 4px);
        font-size: var(--md-font-body);
        background: var(--md-surface, #fff);
        color: var(--md-on-surface, #1c1b1f);
    }

    .disk-input:focus {
        outline: none;
        border-color: var(--md-primary);
    }

    .disk-input:disabled {
        background-color: var(--md-surface-variant);
        color: var(--md-on-surface-variant);
        cursor: not-allowed;
    }

    .disk-unit {
        margin-left: 6px;
        font-size: var(--md-font-caption);
        color: var(--md-on-surface-variant);
    }

    .disk-problem {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        color: var(--md-error, #b3261e);
    }

    .disk-problem .hint-icon {
        font-size: 1rem;
        color: var(--md-error, #b3261e);
    }

    /* Set apart from the static hint above it: this line is about *your* last
       run, and reading as a second sentence of the generic copy would bury it. */
    .previous-run {
        display: flex;
        align-items: flex-start;
        gap: 6px;
        padding-top: var(--md-spacing-sm);
        border-top: 1px solid var(--md-outline-variant, #cac4d0);
    }

    .previous-run .hint-icon {
        font-size: 1rem;
        color: var(--md-primary-dark, #1565c0);
    }

    .secrets-section {
        margin-top: var(--md-spacing-md);
        padding: var(--md-spacing-sm) var(--md-spacing-md);
        border: 1px solid var(--md-outline-variant, #cac4d0);
        border-radius: var(--md-shape-corner-small, 4px);
        background: var(--md-surface-variant, #f3edf7);
    }

    .secrets-header {
        display: flex;
        align-items: center;
        gap: var(--md-spacing-sm);
        margin-bottom: var(--md-spacing-sm);
    }

    .secrets-icon {
        font-size: 1rem;
        color: var(--md-primary-dark, #1565c0);
    }

    .secrets-label {
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--md-on-surface, #1c1b1f);
    }

    .secrets-hint {
        font-size: 0.75rem;
        color: var(--md-on-surface-variant, #49454f);
        flex: 1;
    }

    .add-secret-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: 1px solid var(--md-outline-variant, #cac4d0);
        border-radius: 50%;
        width: 34px;
        min-width: 34px;
        cursor: pointer;
        color: var(--md-primary-dark, #1565c0);
        padding: 0;
    }

    .add-secret-btn .material-icons {
        font-size: 1rem;
    }

    .add-secret-btn:hover:not(:disabled) {
        background: var(--md-primary-container, #eaddff);
    }

    .secret-row {
        display: flex;
        gap: var(--md-spacing-xs, 4px);
        margin-bottom: var(--md-spacing-xs, 4px);
    }

    .secret-key-input {
        padding: var(--md-spacing-sm);
        width: 35%;
        font-family: monospace;
        font-size: 0.8rem;
        text-transform: uppercase;
    }

    .secret-separator {
        font-weight: bold;
        color: var(--md-on-surface-variant, #49454f);
    }

    .secret-value-input {
        padding: var(--md-spacing-sm);
        flex: 1;
        font-family: monospace;
        font-size: 0.8rem;
    }

    .remove-secret-btn {
        display: flex;
        align-items: center;
        justify-content: center;
        background: none;
        border: none;
        border-radius: 50%;
        width: 34px;
        height: 20px;
        min-width: 34px;
        cursor: pointer;
        color: var(--md-error, #b3261e);
        padding: 0;
    }

    .remove-secret-btn .material-icons {
        font-size: 1rem;
    }

    .remove-secret-btn:hover:not(:disabled) {
        background: var(--md-error-container, #f9dedc);
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
</style>
