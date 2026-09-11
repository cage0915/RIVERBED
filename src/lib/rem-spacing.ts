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
