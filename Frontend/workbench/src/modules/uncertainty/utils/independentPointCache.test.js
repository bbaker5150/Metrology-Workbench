import { describe, expect, it, vi } from 'vitest';
import { createIndependentPointCache } from './independentPointCache';
import { getPointDiagnosticEntries } from './pointDiagnostics';
import { computePointTmdeLimits } from './pointTmdeLimits';
import { pointDisplayResolution } from './pointLimitDisplay';
import { getPointRequirements } from './pointRequirements';

describe('independent sidebar point evaluations', () => {
  it('evaluates just the edited point in a 2,000-point session and prunes removed points', () => {
    const evaluate = vi.fn(point => ({ value: point.value }));
    const cached = createIndependentPointCache(evaluate);
    const points = Array.from({ length: 2000 }, (_, id) => ({ id, value: id }));
    const session = { id: 'session', testPoints: points, tmdes: [] };
    const first = cached(points, session);
    evaluate.mockClear();
    const edited = points.map(point => point.id === 800 ? { ...point, value: 42 } : point);
    const next = cached(edited, { ...session, testPoints: edited });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(next.get(800)).toEqual({ value: 42 });
    expect(next.get(799)).toBe(first.get(799));
    cached(edited.slice(1), session);
    evaluate.mockClear();
    cached(edited, session);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(evaluate.mock.calls[0][0]).toBe(points[0]);
  });

  it('invalidates shared edits, session changes and only the affected point-specific inputs', () => {
    const evaluate = vi.fn((point, session, risk) => ({ id: point.id, risk, session }));
    const cached = createIndependentPointCache(evaluate);
    const points = [{ id: 'a' }, { id: 'b' }];
    const session = { id: 1, uncReq: {}, tmdes: [] };
    cached(points, session, () => [1]);
    evaluate.mockClear();
    cached(points, session, point => [point.id === 'a' ? 2 : 1]);
    expect(evaluate).toHaveBeenCalledOnce();
    for (const patch of [{ uncReq: { reqPFA: 1 } }, { tmdes: [{}] }, { id: 2 }, { customDefinition: {} }]) {
      evaluate.mockClear();
      cached(points, { ...session, ...patch });
      expect(evaluate).toHaveBeenCalledTimes(2);
    }
    evaluate.mockClear();
    cached(points, session);
    expect(evaluate).toHaveBeenCalledTimes(2);
  });

  it('agrees with live diagnostics, limits, precision and requirements after point and shared edits', () => {
    const evaluate = (point, session, visibleColumns) => ({
      diagnostics: getPointDiagnosticEntries(point, session, { visibleColumns }),
      limits: computePointTmdeLimits(point, session),
      resolution: pointDisplayResolution(point, session),
      requirements: getPointRequirements(point, session),
    });
    const cached = createIndependentPointCache(evaluate);
    const base = { id: 'a', measurementType: 'direct', associatedUutIds: ['uut'],
      testPointInfo: { parameter: { value: 10, unit: 'V' } },
      uutTolerance: { unit: 'V', resolution: 0.01, reading: { high: 1, low: -1, unit: '%' } },
      components: [{ id: 'manual', name: 'Manual', value: 0.1, value_native: 0.1, unit_native: 'V' }],
      tmdeTolerances: [] };
    let points = [base, { ...base, id: 'b' }];
    let session = { id: 1, uncReq: { reqPFA: 2 }, tmdes: [], uuts: [] };
    const columns = { pfa: true, warningIcons: true };
    for (const update of [
      () => {},
      () => { points = [{ ...base, testPointInfo: { parameter: { value: '', unit: 'V' } } }, points[1]]; },
      () => { points = [{ ...base, riskRequirements: { reqPFA: 1 } }, points[1]]; },
      () => { session = { ...session, uncReq: { reqPFA: 3, neededTUR: 6 } }; },
      () => { points = [{ ...base, uutTolerance: { ...base.uutTolerance, resolution: 0.001 } }, points[1]]; },
    ]) {
      update();
      session = { ...session, testPoints: points };
      const result = cached(points, session, () => [columns]);
      for (const point of points) expect(result.get(point.id)).toEqual(evaluate(point, session, columns));
    }
  });
});
