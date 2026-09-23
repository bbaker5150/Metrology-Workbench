import { expect, it } from 'vitest';
import { getPointRequirements, getPointRequirementOverrides, setPointRequirement, sessionForPoint } from './pointRequirements';
import { computePointRiskMetrics } from './riskCompute';
import { suppliedCase } from './risk8/suppliedBiasParity.fixtures';
import vectors from './risk8/suppliedBiasParityVectors.json';
import { getPointDiagnosticEntries } from './pointDiagnostics';

it('inherits defaults, persists a point-only override and resets to inheritance', () => {
  const { point, session } = suppliedCase(vectors.cases[0]);
  const saved = JSON.stringify(session);
  const changed = setPointRequirement(point, session, 'uncertaintyConfidence', '90');
  expect(getPointRequirements(point, session).uncertaintyConfidence).toBe(95);
  expect(getPointRequirements(changed, session).uncertaintyConfidence).toBe('90');
  expect(getPointRequirementOverrides(changed, session).map(f => f.name)).toEqual(['uncertaintyConfidence']);
  expect(getPointDiagnosticEntries(changed, session).some(d => d.message.includes('Confidence Level'))).toBe(true);
  const actual = computePointRiskMetrics(changed, session, true);
  const equivalentSession = { ...session, uncReq: { ...session.uncReq, uncertaintyConfidence: '90' } };
  expect(actual).toEqual(computePointRiskMetrics(point, equivalentSession, true));
  expect(actual.tur).not.toBe(computePointRiskMetrics(point, session, true).tur);
  expect(JSON.stringify(session)).toBe(saved);
  expect(sessionForPoint(point, session)).toBe(session);
  expect(setPointRequirement(changed, session, 'uncertaintyConfidence', '').riskRequirements).toEqual({});
  expect(setPointRequirement(changed, session, 'uncertaintyConfidence', '95').riskRequirements).toEqual({});
});
