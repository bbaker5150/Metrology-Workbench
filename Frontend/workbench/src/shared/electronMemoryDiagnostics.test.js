// @vitest-environment node
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { startMemoryDiagnostics } = createRequire(import.meta.url)('../../public/memory-diagnostics.cjs');

afterEach(() => vi.useRealTimers());

function fixture(executeJavaScript = vi.fn().mockResolvedValue({ usedBytes: 100, totalBytes: 200, limitBytes: 300 })) {
  const record = vi.fn();
  const contents = {
    getOSProcessId: () => 42, isDevToolsOpened: () => false,
    isDestroyed: () => false, isLoadingMainFrame: () => false, executeJavaScript,
  };
  const window = { isDestroyed: vi.fn(() => false), webContents: contents };
  const app = { getAppMetrics: () => [{ pid: 42, type: 'Tab', memory: { workingSetSize: 123 }, cpu: { percentCPUUsage: 1 } }] };
  const stop = startMemoryDiagnostics({ app, window, systemMemory: () => ({ free: 456 }), record, intervalMs: 1000 });
  return { record, window, contents, app, stop };
}

describe('persistent Electron memory diagnostics', () => {
  it('records OS memory and renderer heap with explicit units without retaining a history', async () => {
    vi.useFakeTimers();
    const { record, stop } = fixture();
    await vi.advanceTimersByTimeAsync(2000);
    expect(record.mock.calls.filter(([event]) => event === 'memory_sample')).toHaveLength(3);
    expect(record).toHaveBeenCalledWith('memory_sample', expect.objectContaining({ unit: 'KiB', rendererPid: 42, devToolsOpen: false, system: { free: 456 } }));
    expect(record).toHaveBeenCalledWith('renderer_heap_sample', { usedBytes: 100, totalBytes: 200, limitBytes: 300 });
    stop();
    const count = record.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(record).toHaveBeenCalledTimes(count);
  });

  it('keeps OS samples running while a stuck renderer has only one outstanding probe', async () => {
    vi.useFakeTimers();
    let resolve;
    const probe = vi.fn(() => new Promise(done => { resolve = done; }));
    const { record, stop } = fixture(probe);
    await vi.advanceTimersByTimeAsync(60000);
    expect(probe).toHaveBeenCalledTimes(1);
    expect(record.mock.calls.filter(([event]) => event === 'memory_sample')).toHaveLength(61);
    stop();
    resolve({ usedBytes: 999 });
    await vi.advanceTimersByTimeAsync(1);
    expect(record.mock.calls.some(([event]) => event === 'renderer_heap_sample')).toBe(false);
  });

  it('recovers from rejected and synchronous failed probes without affecting the run', async () => {
    vi.useFakeTimers();
    const probe = vi.fn().mockImplementationOnce(() => { throw new Error('closed'); })
      .mockRejectedValueOnce(new Error('navigation')).mockResolvedValue({ usedBytes: 123 });
    const { record, stop } = fixture(probe);
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe).toHaveBeenCalledTimes(3);
    expect(record).toHaveBeenCalledWith('renderer_heap_sample', { usedBytes: 123 });
    stop();
  });

  it('does not release a stalled probe when OS metrics temporarily fail', async () => {
    vi.useFakeTimers();
    const probe = vi.fn(() => new Promise(() => {}));
    const { app, stop } = fixture(probe);
    await vi.advanceTimersByTimeAsync(0);
    const getMetrics = app.getAppMetrics;
    app.getAppMetrics = () => { throw new Error('OS metrics unavailable'); };
    await vi.advanceTimersByTimeAsync(1000);
    app.getAppMetrics = getMetrics;
    await vi.advanceTimersByTimeAsync(2000);
    expect(probe).toHaveBeenCalledTimes(1);
    stop();
  });

  it('does not query destroyed windows', async () => {
    vi.useFakeTimers();
    const { window, contents, stop } = fixture();
    window.isDestroyed.mockReturnValue(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(contents.executeJavaScript).toHaveBeenCalledTimes(1);
    stop();
  });
});
