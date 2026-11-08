import assert from 'node:assert/strict';
import test from 'node:test';

import { justifiedRows } from './justified-rows.ts';

const OPTIONS = { width: 1000, gap: 5, targetHeight: 150 };

const rowHeight = (ratios, { start, end, spacerGrow }, { width, gap }) => {
    const sum = ratios.slice(start, end).reduce((total, ratio) => total + ratio, 0);
    const gaps = spacerGrow > 0 ? end - start : end - start - 1;
    return (width - gaps * gap) / (sum + spacerGrow);
};

test('no photos make no rows', () => {
    assert.deepEqual(justifiedRows([], OPTIONS), []);
});

test('rows keep every photo once and in order', () => {
    const ratios = [1.5, 0.67, 1.33, 1.5, 0.75, 2.4, 1, 1.5, 0.67, 0.67, 1.5];
    const rows = justifiedRows(ratios, OPTIONS);
    assert.equal(rows[0].start, 0);
    assert.equal(rows.at(-1).end, ratios.length);
    rows.forEach((row, index) => {
        assert.ok(row.end > row.start);
        if (index > 0) assert.equal(row.start, rows[index - 1].end);
    });
});

test('narrow photos share rows in greater numbers while heights stay close', () => {
    const landscape = Array(10).fill(1.5);
    const portrait = Array(13).fill(0.67);
    const ratios = [...landscape, ...portrait, 1.5];
    const rows = justifiedRows(ratios, OPTIONS);
    const counts = new Set(rows.slice(0, -1).map((row) => row.end - row.start));
    assert.ok(counts.size > 1);
    rows.slice(0, -1).forEach((row) => {
        const height = rowHeight(ratios, row, OPTIONS);
        assert.ok(height > 120 && height < 190, `row height ${height}`);
    });
});

test('only a short last row gets a spacer, which holds it at the target height', () => {
    const ratios = Array(8).fill(1.5);
    const rows = justifiedRows(ratios, OPTIONS);
    rows.slice(0, -1).forEach((row) => assert.equal(row.spacerGrow, 0));

    const short = justifiedRows([1.5, 1], OPTIONS);
    assert.equal(short.length, 1);
    assert.ok(short[0].spacerGrow > 0);
    assert.ok(Math.abs(rowHeight([1.5, 1], short[0], OPTIONS) - 150) < 1e-9);
});

test('a very wide photo still gets a row', () => {
    const rows = justifiedRows([12], OPTIONS);
    assert.deepEqual(rows, [{ start: 0, end: 1, spacerGrow: 0 }]);
});
