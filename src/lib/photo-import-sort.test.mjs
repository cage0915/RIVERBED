import assert from "node:assert/strict";
import test from "node:test";

import { sortPhotoImportFiles } from "./photo-import-sort.ts";

const files = [
    { name: "KCS10.jpg", lastModified: 300 },
    { name: "KCS2.jpg", lastModified: 100 },
    { name: "KCS1.jpg", lastModified: 300 },
];

test("photo import files sort naturally by filename in either direction", () => {
    assert.deepEqual(
        sortPhotoImportFiles(files, "name", "asc").map(({ name }) => name),
        ["KCS1.jpg", "KCS2.jpg", "KCS10.jpg"],
    );
    assert.deepEqual(
        sortPhotoImportFiles(files, "name", "desc").map(({ name }) => name),
        ["KCS10.jpg", "KCS2.jpg", "KCS1.jpg"],
    );
    assert.deepEqual(files.map(({ name }) => name), ["KCS10.jpg", "KCS2.jpg", "KCS1.jpg"]);
});

test("photo import files sort by modified time with a deterministic filename tie break", () => {
    assert.deepEqual(
        sortPhotoImportFiles(files, "time", "asc").map(({ name }) => name),
        ["KCS2.jpg", "KCS1.jpg", "KCS10.jpg"],
    );
    assert.deepEqual(
        sortPhotoImportFiles(files, "time", "desc").map(({ name }) => name),
        ["KCS10.jpg", "KCS1.jpg", "KCS2.jpg"],
    );
});
