export type MountainViewSettings = {
    tagColumns: number;
};

export const DEFAULT_MOUNTAIN_VIEW_SETTINGS: MountainViewSettings = {
    tagColumns: 5,
};

export function sanitizeMountainViewSettings(
    input: unknown,
): MountainViewSettings {
    if (!input || typeof input !== "object") {
        throw new Error("Invalid mountain view settings");
    }

    const tagColumns = (input as Record<string, unknown>).tagColumns;
    if (
        typeof tagColumns !== "number" ||
        !Number.isInteger(tagColumns) ||
        tagColumns < 1 ||
        tagColumns > 8
    ) {
        throw new Error("Tags per row must be an integer from 1 to 8");
    }

    return { tagColumns };
}
