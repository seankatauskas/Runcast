import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('current planning configuration', () => {
  it.each(['off', 'active'])('supports canopy %s without legacy rollout flags', async (mode) => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('CANOPY_MODEL_MODE', mode);
    vi.resetModules();
    const { config } = await import('./config');
    expect(config.canopyModelMode).toBe(mode);
    expect(config).not.toHaveProperty('features');
  });
  it('rejects retired canopy shadow configuration', async () => {
    vi.stubEnv('CANOPY_MODEL_MODE', 'shadow');
    vi.resetModules();
    await expect(import('./config')).rejects.toThrow();
  });
});
