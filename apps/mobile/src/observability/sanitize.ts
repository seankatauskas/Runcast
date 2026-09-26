const REDACTED = '[redacted]';
const SENSITIVE_KEY =
  /(?:authorization|cookie|token|secret|password|body|payload|gpx|geometry|coordinate|latitude|longitude|route|email|displayName|user|account|athlete|push)/i;
const SAFE_REFERENCE_KEY = /^(?:event_id|eventId|requestId|deliveryId|publicationId|errorCode)$/;

export function sanitizeDiagnosticText(value: string): string {
  return value
    .replace(/ExponentPushToken\[[^\]]+\]/gi, REDACTED)
    .replace(/\bBearer\s+[^\s]+/gi, `Bearer ${REDACTED}`)
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED)
    .replace(/<gpx\b[\s\S]*?<\/gpx>/gi, REDACTED)
    .replace(/\b(?:-?\d{1,2}\.\d{4,})\s*,\s*(?:-?\d{1,3}\.\d{4,})\b/g, REDACTED)
    .replace(/\b(?:eyJ[A-Za-z0-9_-]{16,}|[A-Fa-f0-9]{32,})\b/g, REDACTED)
    .replace(/([?&](?:token|code|state|key|authorization)=)[^&#\s]+/gi, `$1${REDACTED}`);
}

function sanitizeUnknown(value: unknown, key = '', depth = 0): unknown {
  if (SAFE_REFERENCE_KEY.test(key)) return value;
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === 'string') return sanitizeDiagnosticText(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 5) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitizeUnknown(item, '', depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitizeUnknown(childValue, childKey, depth + 1),
    ]),
  );
}

export function sanitizeSentryEvent<T extends object>(event: T): T {
  const sanitized = sanitizeUnknown(event) as T;
  const record = sanitized as Record<string, unknown>;
  delete record.user;
  delete record.request;
  delete record.extra;
  delete record.contexts;
  if (Array.isArray(record.breadcrumbs)) {
    record.breadcrumbs = record.breadcrumbs.flatMap((breadcrumb) => {
      const next = sanitizeSentryBreadcrumb(breadcrumb as Record<string, unknown>);
      return next ? [next] : [];
    });
  }
  return sanitized;
}

export function sanitizeSentryBreadcrumb<T extends object>(breadcrumb: T): T | null {
  const record = breadcrumb as Record<string, unknown>;
  const category = typeof record.category === 'string' ? record.category : '';
  if (/^(?:console|fetch|xhr|http|navigation|ui|touch)/i.test(category)) return null;
  const safe = {
    ...(record.type === undefined ? {} : { type: record.type }),
    ...(record.category === undefined ? {} : { category: record.category }),
    ...(record.level === undefined ? {} : { level: record.level }),
    ...(record.timestamp === undefined ? {} : { timestamp: record.timestamp }),
    ...(typeof record.message === 'string'
      ? { message: sanitizeDiagnosticText(record.message) }
      : {}),
    ...(record.data && typeof record.data === 'object'
      ? {
          data: Object.fromEntries(
            Object.entries(record.data).flatMap(([key, value]) =>
              SAFE_REFERENCE_KEY.test(key) || /^(?:method|status_code|status)$/i.test(key)
                ? [[key, sanitizeUnknown(value, key)]]
                : [],
            ),
          ),
        }
      : {}),
  };
  return safe as T;
}
