const sensitiveKeyNames = new Set([
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "clientsecret",
  "codeverifier",
  "authorization",
  "password",
  "apikey",
  "token",
  "secret",
]);
const querySecretPattern = /(code|state|access_token|refresh_token|id_token|token)=[^&\s"']+/gi;
const meetUrlPathPattern = /(meet\.google\.com\/)[A-Za-z0-9-]+/gi;
const maxDepth = 6;

const normalizedKeyName = (key: string): string => key.replace(/[_-]/g, "").toLowerCase();

const sanitizeString = (value: string): string =>
  value
    .replace(meetUrlPathPattern, "$1[REDACTED]")
    .replace(querySecretPattern, (_match, key: string) => `${key}=[REDACTED]`);

const sanitizeValue = (value: unknown, depth: number, seen: WeakSet<object>): unknown => {
  if (typeof value === "string") return sanitizeString(value);
  if (value === null || typeof value !== "object") return value;

  if (seen.has(value)) return "[Circular]";
  if (depth >= maxDepth) return "[MaxDepth]";

  seen.add(value);
  if (value instanceof Error) {
    const sanitizedError = {
      name: sanitizeString(value.name),
      message: sanitizeString(value.message),
      stack: value.stack === undefined ? undefined : sanitizeString(value.stack),
    };
    seen.delete(value);
    return sanitizedError;
  }

  if (Array.isArray(value)) {
    const sanitizedArray = value.map((item) => sanitizeValue(item, depth + 1, seen));
    seen.delete(value);
    return sanitizedArray;
  }

  const sanitizedObject: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitizedObject[key] = sensitiveKeyNames.has(normalizedKeyName(key))
      ? "[REDACTED]"
      : sanitizeValue(item, depth + 1, seen);
  }

  seen.delete(value);
  return sanitizedObject;
};

export const sanitizeForLog = (value: unknown): unknown => sanitizeValue(value, 0, new WeakSet());
