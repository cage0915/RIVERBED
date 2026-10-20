import assert from "node:assert/strict";
import test from "node:test";

import { selectPhotoImportIndex } from "./photo-import-selection.ts";

const choose = (overrides = {}) => selectPhotoImportIndex({
    selected: new Set(),
    index: 2,
    anchorIndex: null,
    itemCount: 8,
    additive: false,
    range: false,
    ...overrides,
});

test("plain and Ctrl/Cmd photo clicks replace or toggle the selection", () => {
    assert.deepEqual([...choose({ selected: new Set([0, 1]) }).selected], [2]);
    assert.deepEqual([...choose({ selected: new Set([0, 1]), additive: true }).selected], [0, 1, 2]);
    assert.deepEqual([...choose({ selected: new Set([0, 2]), additive: true }).selected], [0]);
});

test("Shift photo clicks select an inclusive range from the stable anchor", () => {
    const replaced = choose({ selected: new Set([7]), index: 5, anchorIndex: 2, range: true });
    assert.deepEqual([...replaced.selected], [2, 3, 4, 5]);
    assert.equal(replaced.anchorIndex, 2);

    const added = choose({
        selected: new Set([0, 7]),
        index: 4,
        anchorIndex: 2,
        additive: true,
        range: true,
    });
    assert.deepEqual([...added.selected].sort((a, b) => a - b), [0, 2, 3, 4, 7]);
    assert.equal(added.anchorIndex, 2);
});

test("an initial Shift click establishes its own range anchor", () => {
    const result = choose({ index: 4, range: true });
    assert.deepEqual([...result.selected], [4]);
    assert.equal(result.anchorIndex, 4);
});
