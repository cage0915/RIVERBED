import assert from 'node:assert/strict';
import test from 'node:test';

import { rowItemFlex, rowItemWidths, stackedRatio } from './photo-row-layout.ts';

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
