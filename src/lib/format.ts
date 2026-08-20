/**
 * Display helpers shared between components.
 *
 * Small on purpose. `formatBytes` moved here from JobMonitor when the worker-size
 * picker started needing it too (P4.3): the peak memory in the monitor's metrics
 * table and the peak quoted beside the picker are the same number, and two
 * formatters would eventually disagree about it in front of the same user.
 */

/**
 * Bytes as a human-readable size, binary-stepped and labelled in the decimal
 * spelling ("GB") the rest of the UI uses.
 *
 * Behaviour is byte-for-byte what JobMonitor did before the move -- two decimal
 * places, "N/A" for absent, and a ladder that stops at GB -- so nothing already
 * on screen changes. Stopping at GB is fine here: the largest rung is 250 GiB.
 */
export function formatBytes(bytes: number | undefined): string {
    if (bytes === undefined || Number.isNaN(bytes)) return 'N/A';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}
