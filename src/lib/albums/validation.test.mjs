import assert from "node:assert/strict";
import test from "node:test";

import { validateAlbumInventory } from "./validation.ts";

const MANIFEST_PATH = "src/album-manifests/yama/walk.json";

function manifest(filenames, blocks, cover = { kind: "local", filename: filenames[0] }) {
    return {
        schemaVersion: 2,
        title: "Walk",
        order: 1,
        cover: {
            photo: cover,
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        blocks,
        photos: filenames.map((filename) => ({ filename, tags: [] })),
    };
}

const row = (...photos) => ({ type: "Row", photos });

function validate({ filenames, blocks, cover }) {
    return validateAlbumInventory({
        albumSlug: "yama/walk",
        manifestPath: MANIFEST_PATH,
        manifest: manifest(filenames, blocks, cover),
    });
}

test("reports a photo placed by more than one block", () => {
    const diagnostics = validate({
        filenames: ["A.jpg"],
        blocks: [row("A.jpg"), { type: "PhotoCarousel", photos: ["A.jpg"] }],
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["duplicate-block-photo"]);
    assert.equal(diagnostics[0].sourcePath, MANIFEST_PATH);
    assert.equal(diagnostics[0].fieldPath, "blocks");
    assert.match(diagnostics[0].message, /A\.jpg/);
});

test("reports a block photo missing from the manifest", () => {
    const diagnostics = validate({
        filenames: ["A.jpg"],
        blocks: [row("A.jpg", { column: ["B.jpg", "A2.jpg"] })],
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), [
        "block-photo-missing-from-manifest",
        "block-photo-missing-from-manifest",
    ]);
    assert.match(diagnostics[0].message, /B\.jpg.*manifest/i);
});

test("reports manifest-only photos that are not the selected local cover", () => {
    const diagnostics = validate({
        filenames: ["A.jpg", "unused.jpg"],
        blocks: [row("A.jpg")],
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["manifest-photo-not-in-blocks"]);
    assert.equal(diagnostics[0].sourcePath, MANIFEST_PATH);
    assert.equal(diagnostics[0].fieldPath, "photos[1].filename");
});

test("allows exactly the selected local cover to be manifest-only", () => {
    const diagnostics = validate({
        filenames: ["cover.jpg", "A.jpg"],
        cover: { kind: "local", filename: "cover.jpg" },
        blocks: [row("A.jpg")],
    });

    assert.deepEqual(diagnostics, []);
});

test("an external cover does not excuse unused local inventory", () => {
    const diagnostics = validate({
        filenames: ["A.jpg", "unused.jpg"],
        cover: { kind: "external", assetKey: "yama/other/cover.jpg" },
        blocks: [row("A.jpg")],
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["manifest-photo-not-in-blocks"]);
    assert.match(diagnostics[0].message, /unused\.jpg/);
});

test("reports when manifest content order differs from block order", () => {
    const diagnostics = validate({
        filenames: ["B.jpg", "A.jpg"],
        cover: { kind: "local", filename: "B.jpg" },
        blocks: [row("A.jpg"), row("B.jpg")],
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["manifest-photo-order-mismatch"]);
    assert.equal(diagnostics[0].fieldPath, "photos");
    assert.match(diagnostics[0].message, /A\.jpg.*B\.jpg/);
});

test("returns no diagnostics for matching blocks and manifest inventory", () => {
    const diagnostics = validate({
        filenames: ["A.jpg", "B.jpg", "C.jpg"],
        blocks: [
            { type: "Text", text: "Morning" },
            row("A.jpg", { column: ["B.jpg", "C.jpg"] }),
        ],
    });

    assert.deepEqual(diagnostics, []);
});
