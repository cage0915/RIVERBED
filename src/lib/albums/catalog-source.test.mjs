import assert from "node:assert/strict";
import test from "node:test";

import {
    buildAlbumCatalogFromSources,
    createAlbumSummaryReader,
} from "./catalog-source.ts";

function validManifest(overrides = {}) {
    return {
        schemaVersion: 1,
        title: "Source",
        order: 10,
        cover: {
            photo: { kind: "local", filename: "A.jpg" },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        photos: [{ filename: "A.jpg" }],
        ...overrides,
    };
}

test("manifest parse failures name the exact manifest path and preserve their cause", () => {
    const manifestPath = "/src/album-manifests/yama/source.json";
    assert.throws(
        () => buildAlbumCatalogFromSources(
            [{
                slug: "yama/source",
                mdxPath: "/src/content/albums/yama/source.mdx",
                mdxBody: '<Photo itemKey="A.jpg" />',
            }],
            { [manifestPath]: { default: validManifest({ title: "" }) } },
        ),
        (error) => {
            assert.match(error.message, new RegExp(manifestPath));
            assert.match(error.message, /title must not be empty/);
            assert.ok(error.cause instanceof Error);
            assert.match(error.cause.message, /title must not be empty/);
            return true;
        },
    );
});

test("catalog validation failures include their code, actionable source path, and field", () => {
    const mdxPath = "/src/content/albums/yama/source.mdx";
    assert.throws(
        () => buildAlbumCatalogFromSources(
            [{
                slug: "yama/source",
                mdxPath,
                mdxBody: '<Photo itemKey="missing.jpg" />',
            }],
            {
                "/src/album-manifests/yama/source.json": {
                    default: validManifest(),
                },
            },
        ),
        (error) => {
            assert.match(
                error.message,
                /\[mdx-photo-missing-from-manifest\] yama\/source sourcePath=\/src\/content\/albums\/yama\/source\.mdx manifestPath=\/src\/album-manifests\/yama\/source\.json fieldPath=Photo@0:/,
            );
            return true;
        },
    );
});

test("summary reader snapshots full albums once and returns defensive cover clones", () => {
    let calls = 0;
    const album = {
        ...validManifest(),
        slug: "yama/source",
        folder: "yama",
        albumId: "source",
        cover: {
            ...validManifest().cover,
            assetKey: "yama/source/A.jpg",
        },
        photos: [{
            sourceAlbumSlug: "yama/source",
            sourceAlbumTitle: "Source",
            filename: "A.jpg",
            assetKey: "yama/source/A.jpg",
            tags: [],
            isContent: true,
        }],
    };
    const readSummaries = createAlbumSummaryReader({
        getAlbums() {
            calls += 1;
            return [album];
        },
    });

    assert.equal(calls, 1);
    const first = readSummaries();
    const second = readSummaries();
    assert.equal(calls, 1);
    assert.ok(!("photos" in first[0]));
    assert.notEqual(first[0], second[0]);
    assert.notEqual(first[0].cover, second[0].cover);
    assert.notEqual(first[0].cover.photo, second[0].cover.photo);
    assert.notEqual(first[0].cover.offset, second[0].cover.offset);

    first[0].cover.offset.x = 0;
    assert.equal(second[0].cover.offset.x, 50);
});
