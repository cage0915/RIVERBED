export interface JustifiedRowOptions {
    /** Width the rows must fill, in pixels. */
    width: number;
    /** Space between neighbouring photos, in pixels. */
    gap: number;
    /** Height rows should come as close to as possible, in pixels. */
    targetHeight: number;
}

export interface JustifiedRow {
    /** Index of the row's first photo. */
    start: number;
    /** Index just past the row's last photo. */
    end: number;
    /**
     * Flex grow for an empty item after the photos, on the same scale as the
     * photos' aspect ratios. Above 0 only for a last row too short to fill the
     * width, where it holds the photos at the target height.
     */
    spacerGrow: number;
}

/** Rows shorter than this share of the target stop gaining photos. */
const MIN_HEIGHT_SHARE = 0.5;

/**
 * Splits photos into rows that each fill the width at one shared height, so
 * rows differ in photo count while staying close to the target height. Breaks
 * are chosen across the whole sequence, like line breaking in typesetting, so
 * a good early row can't force a bad one later.
 */
export function justifiedRows(
    ratios: number[],
    { width, gap, targetHeight }: JustifiedRowOptions,
): JustifiedRow[] {
    const count = ratios.length;
    const bestCost = new Array<number>(count + 1).fill(Number.POSITIVE_INFINITY);
    const bestEnd = new Array<number>(count + 1).fill(count);
    bestCost[count] = 0;

    for (let start = count - 1; start >= 0; start -= 1) {
        let ratioSum = 0;
        for (let end = start + 1; end <= count; end += 1) {
            ratioSum += ratios[end - 1];
            const height = (width - (end - start - 1) * gap) / ratioSum;
            // A short last row is not stretched, so it never counts against the layout.
            const rowCost = end === count && height >= targetHeight
                ? 0
                : ((height - targetHeight) / targetHeight) ** 2;
            const cost = rowCost + bestCost[end];
            if (cost < bestCost[start]) {
                bestCost[start] = cost;
                bestEnd[start] = end;
            }
            if (height < targetHeight * MIN_HEIGHT_SHARE) break;
        }
    }

    const rows: JustifiedRow[] = [];
    for (let start = 0; start < count; start = bestEnd[start]) {
        const end = bestEnd[start];
        let spacerGrow = 0;
        if (end === count) {
            const ratioSum = ratios.slice(start, end).reduce((sum, ratio) => sum + ratio, 0);
            // The spacer adds one more gap: one per photo instead of one between photos.
            spacerGrow = Math.max(0, (width - (end - start) * gap) / targetHeight - ratioSum);
        }
        rows.push({ start, end, spacerGrow });
    }
    return rows;
}
