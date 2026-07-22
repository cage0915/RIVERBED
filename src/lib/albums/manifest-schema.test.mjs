import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAssetKey, validateAlbumSlug, validateLocalPhotoFilename } from "./keys.ts";
import { parseAlbumManifest } from "./manifest-schema.ts";

function validManifest(overrides = {}) {
    return {
        schemaVersion: 1,
        title: "A morning walk",
        info: "Along the river",
        publishedAt: "2026-07-22",
        order: 3,
        gap: "1rem",
        cover: {
            photo: { kind: "local", filename: "cover.jpg" },
            zoom: 1.5,
            offset: { x: 25, y: 75 },
        },
        photos: [
            {
                filename: "cover.jpg",
                caption: "First light",
                tags: [{ name: "ridge", x: 10, y: 90 }],
            },
            { filename: "second.webp" },
        ],
        ...overrides,
    };
}

test("parses a valid local cover and defaults omitted photo tags", () => {
    const input = validManifest();
    const manifest = parseAlbumManifest(input, "taiwan/morning-walk");

    assert.equal(manifest.cover.photo.kind, "local");
    assert.deepEqual(manifest.photos[1].tags, []);
    assert.notEqual(manifest.photos[1], input.photos[1]);
});

test("parses and normalizes a valid external cover asset key", () => {
    const manifest = parseAlbumManifest(validManifest({
        cover: {
            photo: { kind: "external", assetKey: "/japan/winter/cover.avif" },
            zoom: 4,
            offset: { x: 0, y: 100 },
        },
    }), "taiwan/morning-walk");

    assert.deepEqual(manifest.cover.photo, {
        kind: "external",
        assetKey: "japan/winter/cover.avif",
    });
});

test("accepts any positive finite cover zoom", () => {
    for (const zoom of [0.5, 5]) {
        const manifest = validManifest({
            cover: { ...validManifest().cover, zoom },
        });
        assert.equal(parseAlbumManifest(manifest, "taiwan/morning-walk").cover.zoom, zoom);
    }
});

test("album and asset key helpers validate and normalize their inputs", () => {
    assert.equal(validateAlbumSlug("taiwan/morning-walk"), "taiwan/morning-walk");
    assert.equal(validateLocalPhotoFilename("photo-01.JPEG"), "photo-01.JPEG");
    assert.equal(normalizeAssetKey("/taiwan/morning-walk/photo.jpg"), "taiwan/morning-walk/photo.jpg");

    for (const slug of ["taiwan", "Taiwan/walk", "taiwan/a/b", "taiwan_/walk", "taiwan//walk"]) {
        assert.throws(() => validateAlbumSlug(slug), /album slug/i);
    }
    for (const filename of ["../photo.jpg", "folder/photo.jpg", "folder\\photo.jpg", ".jpg", "photo.gif"]) {
        assert.throws(() => validateLocalPhotoFilename(filename), /filename/i);
    }
    for (const key of ["taiwan/photo.jpg", "Taiwan/walk/photo.jpg", "taiwan/walk/../photo.jpg", "taiwan/walk/photo.gif"]) {
        assert.throws(() => normalizeAssetKey(key), /asset key/i);
    }
});

test("rejects an invalid local photo path", () => {
    const manifest = validManifest({
        photos: [{ filename: "nested/photo.jpg", tags: [] }],
    });
    assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"), /local filename/i);
});

test("rejects duplicate local photo filenames", () => {
    const manifest = validManifest({
        photos: [
            { filename: "cover.jpg", tags: [] },
            { filename: "cover.jpg", tags: [] },
        ],
    });
    assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"), /duplicate/i);
});

test("rejects a local cover absent from the photo list", () => {
    const manifest = validManifest({
        cover: {
            photo: { kind: "local", filename: "missing.jpg" },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
    });
    assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"), /cover.*photos/i);
});

test("rejects malformed dates, orders, zoom values, and cover offsets", () => {
    const invalidCases = [
        [validManifest({ publishedAt: "2026-7-22" }), /publishedAt/i],
        [validManifest({ publishedAt: "2026-02-30" }), /publishedAt/i],
        [validManifest({ order: 1.5 }), /order/i],
        [validManifest({ order: Number.POSITIVE_INFINITY }), /order/i],
        [validManifest({ cover: { ...validManifest().cover, zoom: 0 } }), /zoom/i],
        [validManifest({ cover: { ...validManifest().cover, zoom: -0.5 } }), /zoom/i],
        [validManifest({ cover: { ...validManifest().cover, zoom: Number.NaN } }), /zoom/i],
        [validManifest({ cover: { ...validManifest().cover, zoom: Number.POSITIVE_INFINITY } }), /zoom/i],
        [validManifest({ cover: { ...validManifest().cover, offset: { x: -1, y: 50 } } }), /offset/i],
        [validManifest({ cover: { ...validManifest().cover, offset: { x: 50, y: 101 } } }), /offset/i],
    ];

    for (const [manifest, message] of invalidCases) {
        assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"), message);
    }
});

test("rejects non-string optional info, gap, and photo captions", () => {
    const invalidCases = [
        [validManifest({ info: 42 }), /info must be a string/i],
        [validManifest({ gap: false }), /gap must be a string/i],
        [validManifest({
            photos: [
                { filename: "cover.jpg", caption: { text: "First light" }, tags: [] },
            ],
        }), /photo 0 caption must be a string/i],
    ];

    for (const [manifest, message] of invalidCases) {
        assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"), message);
    }
});

test("rejects empty tag names and out-of-range tag coordinates", () => {
    for (const tag of [
        { name: "", x: 50, y: 50 },
        { name: "   ", x: 50, y: 50 },
        { name: "ridge", x: -1, y: 50 },
        { name: "ridge", x: 50, y: 101 },
        { name: "ridge", x: Number.NaN, y: 50 },
    ]) {
        const manifest = validManifest({
            photos: [{ filename: "cover.jpg", tags: [tag] }],
        });
        assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"), /tag/i);
    }
});

test("rejects malformed external asset keys and album slugs", () => {
    const manifest = validManifest({
        cover: {
            photo: { kind: "external", assetKey: "taiwan/walk/nested/photo.jpg" },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
    });

    assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"), /asset key/i);
    assert.throws(() => parseAlbumManifest(validManifest(), "taiwan"), /album slug/i);
});

test("rejects unsupported versions, empty titles, and malformed cover unions", () => {
    const invalidCases = [
        validManifest({ schemaVersion: 2 }),
        validManifest({ title: "   " }),
        validManifest({ cover: { ...validManifest().cover, photo: { kind: "local", assetKey: "taiwan/walk/a.jpg" } } }),
        validManifest({ cover: { ...validManifest().cover, photo: { kind: "external", filename: "cover.jpg" } } }),
    ];

    for (const manifest of invalidCases) {
        assert.throws(() => parseAlbumManifest(manifest, "taiwan/morning-walk"));
    }
});
