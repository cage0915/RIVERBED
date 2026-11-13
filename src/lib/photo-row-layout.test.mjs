import assert from 'node:assert/strict';
import test from 'node:test';

import { rowItemFlex, rowItemFlexFromSizes, rowItemWidths, stackedRatio } from './photo-row-layout.ts';

test('stacked photos combine like parallel resistors', () => {
    assert.equal(stackedRatio([1.5, 1.5]), 0.75);
    assert.equal(stackedRatio([2]), 2);
});

test('row widths give a column the same height as its neighbours', () => {
    const gap = 8;
    const column = { ratio: stackedRatio([1.5, 1.5]), extraHeight: gap };
    const photo = { ratio: 2 / 3, extraHeight: 0 };
    const [columnWidth, photoWidth] = rowItemWidths([column, photo], 1000);

    assert.ok(Math.abs(columnWidth + photoWidth - 1000) < 1e-9);
    const columnHeight = 2 * (columnWidth / 1.5) + gap;
    const photoHeight = photoWidth / (2 / 3);
    assert.ok(Math.abs(columnHeight - photoHeight) < 1e-9);
});

test('flex basis compensates column gaps without going negative', () => {
    assert.deepEqual(
        rowItemFlex([{ ratio: 0.75, extraHeight: 8 }, { ratio: 2, extraHeight: 0 }]),
        ['75 1 0px', '200 1 16px'],
    );
    assert.deepEqual(rowItemFlex([{ ratio: 1.5, extraHeight: 0 }]), ['150 1 0px']);
});

test('server flex from manifest sizes matches the measured flex', () => {
    const landscape = { width: 2667, height: 2000 };
    const portrait = { width: 2000, height: 2667 };
    assert.deepEqual(
        rowItemFlexFromSizes([[landscape], [portrait, portrait]]),
        rowItemFlex([
            { ratio: 2667 / 2000, extraHeight: 0 },
            { ratio: stackedRatio([2000 / 2667, 2000 / 2667]), extraHeight: 8 },
        ]),
    );
});

test('server flex leaves the whole row to the client when a size is unknown', () => {
    assert.deepEqual(
        rowItemFlexFromSizes([[{ width: 3000, height: 2000 }], [{}]]),
        [undefined, undefined],
    );
});
