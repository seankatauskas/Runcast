import { describe, expect, it, vi } from 'vitest';

// These mocks throw on import, including transitive imports. Supplying a memory
// repository must not require a database driver or a valid deployment environment.
vi.mock('../config', () => {
  throw new Error(
    'Planning policy must not load config. Wire configuration in planning/runtime.ts.',
  );
});
vi.mock('../db/client', () => {
  throw new Error('Planning policy must not load the database. Use the repository interfaces.');
});
vi.mock('drizzle-orm', () => {
  throw new Error('Move planning SQL into planning/postgres.ts.');
});
vi.mock('postgres', () => {
  throw new Error('Move planning database connections into db/client.ts.');
});

describe('planning dependency boundaries', () => {
  it('loads bundle assembly and preparation policy without production infrastructure', async () => {
    const [service, canopy, bundle] = await Promise.all([
      import('./service'),
      import('./canopy'),
      import('./bundle'),
    ]);

    expect(service.PlanningBundleService).toBeTypeOf('function');
    expect(service.ForecastPreparationCoordinator).toBeTypeOf('function');
    expect(canopy.CanopyPreparationCoordinator).toBeTypeOf('function');
    expect(bundle.assemblePlanningBundleV3).toBeTypeOf('function');
    expect(bundle.assemblePlanningBundleV3).toBeTypeOf('function');
  });
});
