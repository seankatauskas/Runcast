export type ClientCanopyModelMode = 'off' | 'shadow' | 'active';

export function resolveClientCanopyModelMode(value: string | undefined): ClientCanopyModelMode {
  if (value === undefined) return 'active';
  return value === 'off' || value === 'shadow' || value === 'active' ? value : 'off';
}
