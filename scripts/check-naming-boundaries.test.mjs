import { describe, expect, it } from 'vitest';
import { retiredRuntimeViolations } from './check-naming-boundaries.mjs';

const consumer = 'apps/web/src/app/state.ts';
describe('current-only planning runtime boundary', () => {
  it.each([
    "import { computePlan as currentPlan } from '@runcast/core';",
    "export { evaluateRun as evaluate } from '@runcast/core';",
    "import * as core from '@runcast/core'; core.recommendStart({});",
    "import { evaluate } from '../../../../packages/core/src/engine/plan';",
    "await import('../../../../packages/core/src/engine/planning/compatibility');",
    'process.env.PLANNING_V2_EVALUATION_ENABLED;',
    "process.env['EXPO_PUBLIC_PLANNING_AUTHORITY'];",
  ])('rejects a retired runtime reference: %s', (source) => {
    expect(retiredRuntimeViolations(source, consumer)).not.toHaveLength(0);
  });
  it('allows current local aliases and historical DTOs without blanket version exclusions', () => {
    const source = `
      import { recommendStartV3 as recommendStart, evaluateRunV3 as evaluateRun } from '@runcast/core';
      import type { RecommendationV2, PlanningBundleV2 } from '@runcast/contracts';
      import { planningBundleV2Schema } from '@runcast/contracts';
      import { recommendStart } from './currentPresentation';
    `;
    expect(retiredRuntimeViolations(source, consumer)).toEqual([]);
  });
  it('does not hide retired runtime code behind a fixture or compatibility directory', () => {
    const source = "import { evaluateRun } from '@runcast/core';";
    expect(
      retiredRuntimeViolations(source, 'apps/api/src/db/fixtures/history.ts'),
    ).not.toHaveLength(0);
    expect(
      retiredRuntimeViolations(source, 'apps/mobile/src/data/compatibility/history.ts'),
    ).not.toHaveLength(0);
  });
});
