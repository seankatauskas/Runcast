type OperationalLevel = 'info' | 'warn' | 'error';

const SENSITIVE_FIELD =
  /(?:authorization|cookie|token|secret|password|body|payload|gpx|geometry|coordinate|latitude|longitude|routeName|email|displayName)/i;
const SAFE_IDENTIFIER = /(?:Id|Ids)$/;

export function redactedOperationalFields(
  fields: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => {
      if (SENSITIVE_FIELD.test(key) && !SAFE_IDENTIFIER.test(key)) return [key, '[redacted]'];
      if (value instanceof Error) return [key, { name: value.name }];
      if (value && typeof value === 'object') return [key, '[redacted]'];
      return [key, value];
    }),
  );
}

export function operationalEvent(
  level: OperationalLevel,
  event: string,
  fields: Record<string, unknown> = {},
): Record<string, unknown> {
  return { level, event, ...redactedOperationalFields(fields) };
}

export function logOperationalEvent(
  level: OperationalLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const output = JSON.stringify(operationalEvent(level, event, fields));
  if (level === 'error') console.error(output);
  else if (level === 'warn') console.warn(output);
  else console.log(output);
}
