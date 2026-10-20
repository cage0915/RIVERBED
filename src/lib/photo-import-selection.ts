export type PhotoImportSelectionInput = {
    selected: ReadonlySet<number>;
    index: number;
    anchorIndex: number | null;
    itemCount: number;
    additive: boolean;
    range: boolean;
};

export type PhotoImportSelection = {
    selected: Set<number>;
    anchorIndex: number;
};

export function selectPhotoImportIndex({
    selected,
    index,
    anchorIndex,
    itemCount,
    additive,
    range,
}: PhotoImportSelectionInput): PhotoImportSelection {
    if (!Number.isInteger(index) || index < 0 || index >= itemCount) {
        throw new RangeError(`Photo selection index is out of range: ${index}`);
    }

    const next = new Set(additive ? selected : []);
    if (range && anchorIndex !== null && anchorIndex >= 0 && anchorIndex < itemCount) {
        const start = Math.min(anchorIndex, index);
        const end = Math.max(anchorIndex, index);
        for (let candidate = start; candidate <= end; candidate += 1) next.add(candidate);
        return { selected: next, anchorIndex };
    }

    if (additive && next.has(index)) next.delete(index);
    else next.add(index);
    return { selected: next, anchorIndex: index };
}
