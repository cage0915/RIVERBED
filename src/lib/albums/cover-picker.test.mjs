import assert from "node:assert/strict";
import test from "node:test";

import { createCoverPickerInventory } from "./cover-picker.ts";

test("cover picker inventory contains only manifest-tracked local photos with full keys", () => {
    const manifest = {
        schemaVersion: 1,
        title: "Album",
        order: 10,
        cover: { photo: { kind: "local", filename: "a.jpg" }, zoom: 1, offset: { x: 50, y: 50 } },
        photos: [{ filename: "a.jpg", tags: [] }, { filename: "b.jpg", tags: [] }],
    };
    assert.deepEqual(createCoverPickerInventory({ "yama/a": manifest }, "yama/a"), {
        albums: [{ slug: "yama/a", count: 2 }],
        albumSlug: "yama/a",
        photos: [
            { name: "a.jpg", key: "yama/a/a.jpg" },
            { name: "b.jpg", key: "yama/a/b.jpg" },
        ],
    });
});
