const ENABLED_VALUES = new Set(["1", "true", "yes", "on"]);
const DISABLED_VALUES = new Set(["0", "false", "no", "off"]);

export function resolveFeatureFlag(
    value: unknown,
    fallback: boolean,
): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return fallback;

    const normalized = value.trim().toLowerCase();
    if (ENABLED_VALUES.has(normalized)) return true;
    if (DISABLED_VALUES.has(normalized)) return false;
    return fallback;
}
