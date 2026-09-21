// Main-process sampling survives a renderer failure. Keep only numeric totals,
// never readings, session content, credentials, console objects or heap dumps.
// The rotating lifecycle log bounds disk use; no sample history lives in RAM.
function startMemoryDiagnostics({ app, window, systemMemory, record, intervalMs = 60000 }) {
    let stopped = false;
    let heapPending = false;
    const sample = () => {
        if (stopped || window.isDestroyed()) return;
        try {
            const contents = window.webContents;
            record('memory_sample', {
                // Electron reports process and system memory in KiB.
                unit: 'KiB',
                rendererPid: contents.getOSProcessId(),
                devToolsOpen: contents.isDevToolsOpened(),
                system: systemMemory(),
                processes: app.getAppMetrics().map(({ pid, type, memory, cpu }) => ({
                    pid, type, memory, cpuPercent: cpu?.percentCPUUsage,
                })),
            });
            // An unresponsive renderer must not accumulate queued probes. Keep
            // at most one outstanding promise; the main-process sample above
            // still records OS memory on every tick if that promise stalls.
            if (heapPending || contents.isDestroyed() || contents.isLoadingMainFrame()) return;
            heapPending = true;
            Promise.resolve().then(() => stopped ? null : contents.executeJavaScript(`(() => {
                // Electron's process API is exact and reports KiB. Convert to
                // bytes to share the browser fallback's explicitly named units.
                if (typeof process !== 'undefined' && typeof process.getHeapStatistics === 'function') {
                    const heap = process.getHeapStatistics();
                    return { usedBytes: heap.usedHeapSize * 1024,
                        totalBytes: heap.totalHeapSize * 1024, limitBytes: heap.heapSizeLimit * 1024 };
                }
                const memory = performance.memory;
                return memory ? {
                    usedBytes: memory.usedJSHeapSize,
                    totalBytes: memory.totalJSHeapSize,
                    limitBytes: memory.jsHeapSizeLimit
                } : null;
            })()`)).then(heap => {
                if (!stopped && heap) record('renderer_heap_sample', heap);
            }).catch(() => {
                // Navigation/crash may reject a probe. Lifecycle events record
                // those separately; sampling must never affect the live run.
            }).finally(() => { heapPending = false; });
        } catch (_) {
            // Process teardown or unavailable OS metrics cannot stop the app.
            // Do not release a pending probe when an unrelated OS sample fails.
        }
    };
    const timer = setInterval(sample, intervalMs);
    timer.unref?.();
    sample();
    return () => { stopped = true; clearInterval(timer); };
}

module.exports = { startMemoryDiagnostics };
