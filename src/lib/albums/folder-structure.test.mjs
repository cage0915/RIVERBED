import assert from "node:assert/strict";
import test from "node:test";

import { createFolderStructure } from "./folder-structure.ts";

const source = {
    schemaVersion: 1,
    title: "Source",
    info: "Source info",
    order: 20,
    cover: {
        photo: { kind: "local", filename: "cover.jpg" },
        zoom: 1.1,
        offset: { x: 45, y: 55 },
    },
    photos: [
        { filename: "cover.jpg", tags: [] },
        { filename: "shared.jpg", tags: [] },
    ],
};

const consumer = {
    schemaVersion: 1,
    title: "Consumer",
    order: 10,
    cover: {
        photo: { kind: "external", assetKey: "yama/source/shared.jpg" },
        zoom: 1.3,
        offset: { x: 40, y: 70 },
    },
    photos: [{ filename: "own.jpg", tags: [] }],
};

test("folder structure sorts manifests by order and returns full resolved cover keys", () => {
    assert.deepEqual(createFolderStructure({
        "yama/source": source,
        "yama/consumer": consumer,
        "k/other": { ...source, title: "Other" },
    }, "yama"), [
        {
            id: "consumer",
            slug: "yama/consumer",
            title: "Consumer",
            info: undefined,
            coverKey: "yama/source/shared.jpg",
            coverZoom: 1.3,
            coverOffset: { x: 40, y: 70 },
        },
        {
            id: "source",
            slug: "yama/source",
            title: "Source",
            info: "Source info",
            coverKey: "yama/source/cover.jpg",
            coverZoom: 1.1,
            coverOffset: { x: 45, y: 55 },
        },
    ]);
});
