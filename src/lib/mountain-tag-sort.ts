export type MountainTagSortKey = "elevation" | "latitude";
export type MountainTagSortDirection = "desc" | "asc";
export type MountainTagSort = {
    key: MountainTagSortKey;
    direction: MountainTagSortDirection;
};

export type SortableMountainTag = {
    name: string;
    elevation: number;
    latitude: number;
};

export const DEFAULT_MOUNTAIN_TAG_SORT: MountainTagSort = {
    key: "elevation",
    direction: "desc",
};

const compareNames = (left: string, right: string) =>
    left.localeCompare(right, ["zh-Hant", "ja", "en"], {
        numeric: true,
        sensitivity: "base",
    });

export function nextMountainTagSort(
    current: MountainTagSort | null,
    key: MountainTagSortKey,
): MountainTagSort | null {
    if (!current || current.key !== key) {
        return { key, direction: "desc" };
    }
    if (current.direction === "desc") {
        return { key, direction: "asc" };
    }
    return null;
}

export function sortMountainTags<T extends SortableMountainTag>(
    mountains: readonly T[],
    sort: MountainTagSort | null,
): T[] {
    return [...mountains].sort((left, right) => {
        if (!sort) return compareNames(left.name, right.name);

        const difference = left[sort.key] - right[sort.key];
        if (difference !== 0) {
            return sort.direction === "desc" ? -difference : difference;
        }
        return compareNames(left.name, right.name);
    });
}
