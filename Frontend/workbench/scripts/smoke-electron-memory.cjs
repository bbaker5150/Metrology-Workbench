// Run with the installed Electron binary. A hidden, isolated window exercises
// the real OS/heap metrics without opening a bench session or operating hardware.
const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startMemoryDiagnostics } = require('../public/memory-diagnostics.cjs');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'memory-smoke-')));
app.whenReady().then(async () => {
    const deadline = setTimeout(() => app.exit(1), 20000);
    let window;
    let stop;
    try {
        window = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: true, contextIsolation: false } });
        await window.loadURL('data:text/html,<title>Memory diagnostics smoke</title>');
        const samples = [];
        stop = startMemoryDiagnostics({
            app, window, systemMemory: () => process.getSystemMemoryInfo(),
            record: (event, details) => samples.push({ event, ...details }), intervalMs: 100,
        });
        for (let i = 0; i < 100 && !samples.some(row => row.event === 'renderer_heap_sample'); i++) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const memory = samples.find(row => row.event === 'memory_sample');
        const heap = samples.find(row => row.event === 'renderer_heap_sample');
        assert.equal(memory.unit, 'KiB');
        assert.equal(memory.devToolsOpen, false);
        assert(memory.system.total > 0 && memory.system.free >= 0);
        assert(memory.processes.some(row => row.pid === memory.rendererPid && row.memory.workingSetSize > 0));
        assert(heap.usedBytes > 0 && heap.limitBytes >= heap.usedBytes);
        stop();
        const count = samples.length;
        await new Promise(resolve => setTimeout(resolve, 250));
        assert.equal(samples.length, count);
        console.log('PASS real Electron OS/process/renderer heap samples and cleanup', JSON.stringify({ electron: process.versions.electron, memory, heap }));
        window.destroy();
        clearTimeout(deadline);
        app.exit(0);
    } catch (error) {
        console.error(error);
        stop?.();
        if (window && !window.isDestroyed()) window.destroy();
        clearTimeout(deadline);
        app.exit(1);
    }
});
