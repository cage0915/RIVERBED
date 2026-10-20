export type PhotoImportSortKey = "name" | "time";
export type PhotoImportSortDirection = "asc" | "desc";

type SortablePhotoFile = {
    name: string;
    lastModified: number;
};

function compareNames(left: string, right: string): number {
    return left.localeCompare(right, undefined, {
        numeric: true,
        sensitivity: "base",
    }) || left.localeCompare(right);
}

export function sortPhotoImportFiles<T extends SortablePhotoFile>(
    files: readonly T[],
    key: PhotoImportSortKey,
    direction: PhotoImportSortDirection,
): T[] {
    const multiplier = direction === "asc" ? 1 : -1;
    return [...files].sort((left, right) => {
        const primary = key === "time"
            ? left.lastModified - right.lastModified
            : compareNames(left.name, right.name);
        const comparison = primary || compareNames(left.name, right.name);
        return comparison * multiplier;
    });
}
