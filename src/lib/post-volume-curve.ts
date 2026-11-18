/**
 * Builds the SVG paths for a folder card's post-volume curve: one point per
 * post, oldest on the left, height = that post's photo count.
 *
 * Paths live in a 100×100 box (meant for preserveAspectRatio="none"). The
 * vertical scale is shared: `max` is the largest photo count across every
 * folder, so the same height means the same count on every card. Heights use
 * a square-root scale so small folders still show their shape without the
 * largest posts flattening everything else.
 */
export interface PostVolumeCurve {
    line: string;
    area: string;
}

const round = (value: number) => Math.round(value * 100) / 100;

export function postVolumeCurve(counts: number[], max: number): PostVolumeCurve | null {
    if (counts.length === 0 || max <= 0) return null;

    const ys = counts.map((count) => 100 - Math.sqrt(Math.max(0, count) / max) * 100);

    // A single post has no trend to draw, so it is a flat line across the card.
    if (ys.length === 1) {
        const y = round(ys[0]);
        return {
            line: `M0,${y}L100,${y}`,
            area: `M0,${y}L100,${y}L100,100L0,100Z`,
        };
    }

    const step = 100 / (ys.length - 1);
    const xs = ys.map((_, i) => i * step);
    const slopes = ys.slice(1).map((y, i) => (y - ys[i]) / step);

    // Monotone tangents (Steffen): the curve never overshoots a data point,
    // so it cannot dip below zero or above the tallest post.
    const tangents = ys.map((_, i) => {
        if (i === 0) return slopes[0];
        if (i === ys.length - 1) return slopes[i - 1];
        const before = slopes[i - 1];
        const after = slopes[i];
        return (
            (Math.sign(before) + Math.sign(after)) *
            Math.min(Math.abs(before), Math.abs(after), Math.abs(before + after) / 4)
        );
    });

    let line = `M${round(xs[0])},${round(ys[0])}`;
    for (let i = 0; i < ys.length - 1; i++) {
        const third = step / 3;
        line +=
            `C${round(xs[i] + third)},${round(ys[i] + tangents[i] * third)}` +
            ` ${round(xs[i + 1] - third)},${round(ys[i + 1] - tangents[i + 1] * third)}` +
            ` ${round(xs[i + 1])},${round(ys[i + 1])}`;
    }

    return { line, area: `${line}L100,100L0,100Z` };
}
