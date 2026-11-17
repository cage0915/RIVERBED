const NUMERIC_VALUE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

export function remValueForInput(value: unknown): string {
    const text = String(value ?? "").trim();
    if (!text) return "";

    const numericText = text.toLowerCase().endsWith("rem")
        ? text.slice(0, -3).trim()
        : text;
    if (!NUMERIC_VALUE.test(numericText)) return "";

    const numericValue = Number(numericText);
    return Number.isFinite(numericValue)
        ? String(Object.is(numericValue, -0) ? 0 : numericValue)
        : "";
}

export function remValueFromInput(value: unknown): string {
    const numericValue = remValueForInput(value);
    return numericValue === "" ? "" : `${numericValue}rem`;
}

/**
 * A block margin as rendered: the authored (desktop) value times
 * --space-scale, which global.css lowers on phones so every gap shrinks in
 * proportion. A unitless 0 stays 0, since calc(0 * n) is not a length.
 */
export function scaledSpace(value: string): string {
    const text = value.trim();
    return /^[+-]?0*\.?0*$/.test(text) ? "0" : `calc(${text} * var(--space-scale, 1))`;
}
