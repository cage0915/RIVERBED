import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_MOUNTAIN_TAG_SORT,
    nextMountainTagSort,
    sortMountainTags,
} from "./mountain-tag-sort.ts";

const mountains = [
    { name: "南湖大山", elevation: 3742, latitude: 24.361 },
    { name: "富士山", elevation: 3776, latitude: 35.361 },
    { name: "玉山", elevation: 3952, latitude: 23.47 },
];

test("mountain tag sort cycles descending, ascending, then name order", () => {
    assert.deepEqual(DEFAULT_MOUNTAIN_TAG_SORT, {
        key: "elevation",
        direction: "desc",
    });
    assert.deepEqual(nextMountainTagSort(null, "latitude"), {
        key: "latitude",
        direction: "desc",
    });
    assert.deepEqual(
        nextMountainTagSort(
            { key: "latitude", direction: "desc" },
            "latitude",
        ),
        { key: "latitude", direction: "asc" },
    );
    assert.equal(
        nextMountainTagSort(
            { key: "latitude", direction: "asc" },
            "latitude",
        ),
        null,
    );
});

test("mountain tags sort independently by elevation, latitude, or name", () => {
    assert.deepEqual(
        sortMountainTags(mountains, DEFAULT_MOUNTAIN_TAG_SORT).map(
            (mountain) => mountain.name,
        ),
        ["玉山", "富士山", "南湖大山"],
    );
    assert.deepEqual(
        sortMountainTags(mountains, {
            key: "latitude",
            direction: "desc",
        }).map((mountain) => mountain.name),
        ["富士山", "南湖大山", "玉山"],
    );
    assert.deepEqual(
        sortMountainTags(mountains, null).map((mountain) => mountain.name),
        ["玉山", "南湖大山", "富士山"],
    );
});
