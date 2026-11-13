/**
 * A Row item is either a photo or a Column of photos. Both reduce to an
 * aspect ratio plus a fixed vertical extra (the Column's internal gaps):
 * at row height H the item is (H - extraHeight) * ratio wide.
 */
export interface RowItemMetrics {
    ratio: number;
    extraHeight: number;
}

/** Photos side by side share a height; stacked photos share a width. */
export function stackedRatio(ratios: number[]): number {
    return 1 / ratios.reduce((sum, ratio) => sum + 1 / ratio, 0);
}

/**
 * Flex values that give every item the same height. Grow carries the
 * height-proportional part; the basis carries the gap correction, shifted by
 * the largest extra so it never goes negative.
 */
export function rowItemFlex(items: RowItemMetrics[]): string[] {
    const maxExtra = Math.max(0, ...items.map(item => item.extraHeight));
    // Scale grow so the sum is always >= 1; below that Flexbox leaves free space.
    return items.map(({ ratio, extraHeight }) =>
        `${ratio * 100} 1 ${(maxExtra - extraHeight) * ratio}px`);
}

/** Exact item widths for a row whose items must fill `available` pixels. */
export function rowItemWidths(items: RowItemMetrics[], available: number): number[] {
    const totalRatio = items.reduce((sum, item) => sum + item.ratio, 0);
    const offset = items.reduce((sum, item) => sum + item.extraHeight * item.ratio, 0);
    const height = (available + offset) / totalRatio;
    return items.map(({ ratio, extraHeight }) => (height - extraHeight) * ratio);
}

/** Album Columns stack photos with a 0.5rem gap (see the album page styles). */
export const COLUMN_GAP_PX = 8;

/**
 * Server-side flex for a Row from manifest sizes, so the first paint already
 * has equal heights; each item is a photo's size or a Column's photo sizes.
 * Undefined when any size is unknown, leaving the item to the client script.
 */
export function rowItemFlexFromSizes(
    items: { width?: number; height?: number }[][],
): (string | undefined)[] {
    const metrics = items.map((sizes): RowItemMetrics | undefined => {
        if (!sizes.length || sizes.some(({ width, height }) => !width || !height)) return undefined;
        const ratios = sizes.map(({ width, height }) => width! / height!);
        return { ratio: stackedRatio(ratios), extraHeight: COLUMN_GAP_PX * (ratios.length - 1) };
    });
    if (metrics.some((item) => item === undefined)) return items.map(() => undefined);
    return rowItemFlex(metrics as RowItemMetrics[]);
}

function imageRatio(image: HTMLImageElement): number | undefined {
    const width = image.naturalWidth || Number(image.getAttribute('width'));
    const height = image.naturalHeight || Number(image.getAttribute('height'));
    return width > 0 && height > 0 ? width / height : undefined;
}

/** Undefined until every photo in the item has known dimensions. */
export function measureRowItem(item: HTMLElement): RowItemMetrics | undefined {
    if (!item.matches('[data-photo-column]')) {
        const image = item.querySelector('img');
        const ratio = image ? imageRatio(image) : undefined;
        return ratio === undefined ? undefined : { ratio, extraHeight: 0 };
    }

    const images = Array.from(item.querySelectorAll('img'));
    const ratios = images.map(imageRatio);
    if (!ratios.length || ratios.some(ratio => ratio === undefined)) return undefined;
    const gap = parseFloat(getComputedStyle(item).rowGap) || 0;
    return {
        ratio: stackedRatio(ratios as number[]),
        extraHeight: gap * (ratios.length - 1),
    };
}
