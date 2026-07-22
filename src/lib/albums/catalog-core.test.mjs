import assert from "node:assert/strict";
import test from "node:test";

import { createAlbumCatalog } from "./catalog-core.ts";

function manifest({
    title,
    order,
    photos,
    cover = { kind: "local", filename: photos[0].filename },
}) {
    return {
        schemaVersion: 1,
        title,
        order,
        cover: {
            photo: cover,
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        photos: photos.map((photo) => ({ tags: [], ...photo })),
    };
}

function record(slug, albumManifest, filenames) {
    return {
        slug,
        manifestPath: `src/content/albums/${slug}.album.json`,
        mdxPath: `src/content/albums/${slug}.mdx`,
        mdxBody: filenames.map((filename) => `<Photo itemKey="${filename}" />`).join("\n"),
        manifest: albumManifest,
    };
}

test("normalizes local photos and sorts Albums by order then slug", () => {
    const catalog = createAlbumCatalog([
        record("yama/first", manifest({
            title: "First",
            order: 20,
            photos: [{ filename: "A.jpg", caption: "A caption" }],
        }), ["A.jpg"]),
        record("yama/second", manifest({
            title: "Second",
            order: 10,
            photos: [{ filename: "B.jpg" }],
        }), ["B.jpg"]),
        record("k/elsewhere", manifest({
            title: "Elsewhere",
            order: 10,
            photos: [{ filename: "C.jpg" }],
        }), ["C.jpg"]),
    ]);

    assert.deepEqual(catalog.getAlbums().map((album) => album.slug), [
        "k/elsewhere",
        "yama/second",
        "yama/first",
    ]);
    assert.deepEqual(catalog.getAlbumsInFolder("yama").map((album) => album.slug), [
        "yama/second",
        "yama/first",
    ]);
    assert.equal(catalog.getAlbum("missing/album"), null);
    assert.deepEqual(catalog.getAlbum("yama/first").photos[0], {
        sourceAlbumSlug: "yama/first",
        sourceAlbumTitle: "First",
        filename: "A.jpg",
        assetKey: "yama/first/A.jpg",
        caption: "A caption",
        tags: [],
        isContent: true,
    });
    assert.equal(catalog.getAlbum("yama/first").cover.assetKey, "yama/first/A.jpg");
});

test("projects tags only from MDX content in stable Album and content order", () => {
    const taggedA = { name: "白馬岳", x: 10, y: 20 };
    const taggedB = { name: "白馬岳", x: 30, y: 40 };
    const catalog = createAlbumCatalog([
        record("yama/second", manifest({
            title: "Second",
            order: 20,
            photos: [{ filename: "B.jpg", tags: [taggedB] }],
        }), ["B.jpg"]),
        record("yama/first", manifest({
            title: "First",
            order: 10,
            photos: [
                { filename: "A.jpg", tags: [taggedA] },
                { filename: "cover.jpg", tags: [taggedA] },
            ],
            cover: { kind: "local", filename: "cover.jpg" },
        }), ["A.jpg"]),
        record("k/borrower", manifest({
            title: "Borrower",
            order: 30,
            photos: [{ filename: "own.jpg" }],
            cover: { kind: "external", assetKey: "yama/first/A.jpg" },
        }), ["own.jpg"]),
    ]);

    const tagged = catalog.getTaggedPhotos("白馬岳");
    assert.deepEqual(tagged.map((photo) => photo.assetKey), [
        "yama/first/A.jpg",
        "yama/second/B.jpg",
    ]);
    assert.deepEqual(tagged.map((photo) => photo.sourceAlbumSlug), [
        "yama/first",
        "yama/second",
    ]);
    assert.ok(tagged.every((photo) => photo.isContent === true));
    assert.deepEqual(catalog.getExternalCoverReferences("yama/first/A.jpg"), ["k/borrower"]);
});

test("resolves external covers only to tracked manifest inventory", () => {
    const catalog = createAlbumCatalog([
        record("yama/source", manifest({
            title: "Source",
            order: 10,
            photos: [
                { filename: "content.jpg" },
                { filename: "cover-only.jpg" },
            ],
            cover: { kind: "local", filename: "cover-only.jpg" },
        }), ["content.jpg"]),
        record("k/tracked", manifest({
            title: "Tracked borrower",
            order: 10,
            photos: [{ filename: "own.jpg" }],
            cover: { kind: "external", assetKey: "yama/source/cover-only.jpg" },
        }), ["own.jpg"]),
        record("k/missing", manifest({
            title: "Missing borrower",
            order: 20,
            photos: [{ filename: "own.jpg" }],
            cover: { kind: "external", assetKey: "yama/source/not-tracked.jpg" },
        }), ["own.jpg"]),
    ]);

    assert.equal(
        catalog.getAlbum("k/tracked").cover.assetKey,
        "yama/source/cover-only.jpg",
    );
    assert.deepEqual(
        catalog.getExternalCoverReferences("yama/source/cover-only.jpg"),
        ["k/tracked"],
    );
    assert.deepEqual(
        catalog.diagnostics.filter(({ code }) => code === "external-cover-source-missing"),
        [{
            code: "external-cover-source-missing",
            message: "External cover asset \"yama/source/not-tracked.jpg\" is not tracked by any Album manifest inventory",
            albumSlug: "k/missing",
            sourcePath: "src/content/albums/k/missing.album.json",
            manifestPath: "src/content/albums/k/missing.album.json",
            fieldPath: "cover.photo.assetKey",
        }],
    );
});

test("rejects a same-Album photo encoded as an external cover", () => {
    const catalog = createAlbumCatalog([
        record("yama/self-reference", manifest({
            title: "Self reference",
            order: 10,
            photos: [{ filename: "A.jpg" }],
            cover: { kind: "external", assetKey: "yama/self-reference/A.jpg" },
        }), ["A.jpg"]),
    ]);

    assert.deepEqual(catalog.getExternalCoverReferences("yama/self-reference/A.jpg"), []);
    assert.deepEqual(catalog.diagnostics, [{
        code: "external-cover-source-same-album",
        message: "External cover asset \"yama/self-reference/A.jpg\" belongs to the consumer Album; use a local cover reference",
        albumSlug: "yama/self-reference",
        sourcePath: "src/content/albums/yama/self-reference.album.json",
        manifestPath: "src/content/albums/yama/self-reference.album.json",
        fieldPath: "cover.photo.assetKey",
    }]);
});

test("reports inventory, duplicate order, and duplicate slug diagnostics", () => {
    const catalog = createAlbumCatalog([
        record("yama/duplicate", manifest({
            title: "First copy",
            order: 10,
            photos: [{ filename: "A.jpg" }, { filename: "unused.jpg" }],
        }), ["A.jpg"]),
        record("yama/other", manifest({
            title: "Order collision",
            order: 10,
            photos: [{ filename: "B.jpg" }],
        }), ["B.jpg"]),
        record("yama/duplicate", manifest({
            title: "Second copy",
            order: 30,
            photos: [{ filename: "C.jpg" }],
        }), ["C.jpg"]),
    ]);

    assert.deepEqual(catalog.diagnostics.map(({ code }) => code), [
        "manifest-photo-not-in-mdx",
        "duplicate-album-slug",
        "duplicate-album-order",
    ]);
    assert.equal(catalog.getAlbum("yama/duplicate").title, "First copy");
    assert.deepEqual(catalog.getAlbums().map(({ slug }) => slug), [
        "yama/duplicate",
        "yama/other",
    ]);
    const orderDiagnostic = catalog.diagnostics.find(({ code }) => code === "duplicate-album-order");
    const slugDiagnostic = catalog.diagnostics.find(({ code }) => code === "duplicate-album-slug");
    assert.equal(orderDiagnostic.sourcePath, "src/content/albums/yama/other.album.json");
    assert.equal(orderDiagnostic.fieldPath, "order");
    assert.equal(slugDiagnostic.sourcePath, "src/content/albums/yama/duplicate.album.json");
    assert.equal(slugDiagnostic.fieldPath, "slug");
});

test("reports and skips an invalid Album slug", () => {
    const catalog = createAlbumCatalog([
        record("not-a-slug", manifest({
            title: "Invalid",
            order: 10,
            photos: [{ filename: "A.jpg" }],
        }), ["A.jpg"]),
    ]);

    assert.deepEqual(catalog.getAlbums(), []);
    assert.deepEqual(catalog.diagnostics, [{
        code: "invalid-album-slug",
        message: "Invalid album slug: not-a-slug",
        albumSlug: "not-a-slug",
        sourcePath: "src/content/albums/not-a-slug.album.json",
        manifestPath: "src/content/albums/not-a-slug.album.json",
        fieldPath: "slug",
    }]);
});

test("does not alias caller input or mutable query results", () => {
    const tag = { name: "白馬岳", x: 10, y: 20 };
    const inputManifest = manifest({
        title: "Snapshot",
        order: 10,
        photos: [{ filename: "A.jpg", caption: "Original", tags: [tag] }],
    });
    const catalog = createAlbumCatalog([
        record("yama/snapshot", inputManifest, ["A.jpg"]),
    ]);

    inputManifest.title = "Mutated input";
    inputManifest.cover.photo.filename = "mutated-cover.jpg";
    inputManifest.cover.offset.x = 0;
    inputManifest.photos[0].filename = "mutated-photo.jpg";
    tag.name = "mutated input tag";

    assert.equal(catalog.getAlbum("yama/snapshot").title, "Snapshot");
    assert.deepEqual(
        catalog.getAlbum("yama/snapshot").photos[0].tags,
        [{ name: "白馬岳", x: 10, y: 20 }],
    );

    const albumResult = catalog.getAlbum("yama/snapshot");
    albumResult.title = "Mutated result";
    albumResult.cover.photo.filename = "mutated-result-cover.jpg";
    albumResult.cover.offset.y = 0;
    albumResult.photos[0].tags[0].name = "mutated result tag";
    albumResult.photos.push(albumResult.photos[0]);

    const albumsResult = catalog.getAlbums();
    albumsResult[0].photos[0].caption = "Mutated list result";
    const taggedResult = catalog.getTaggedPhotos("白馬岳");
    taggedResult[0].tags[0].x = 99;

    const freshAlbum = catalog.getAlbum("yama/snapshot");
    const freshTagged = catalog.getTaggedPhotos("白馬岳");
    assert.equal(freshAlbum.title, "Snapshot");
    assert.deepEqual(freshAlbum.cover, {
        photo: { kind: "local", filename: "A.jpg" },
        zoom: 1,
        offset: { x: 50, y: 50 },
        assetKey: "yama/snapshot/A.jpg",
    });
    assert.equal(freshAlbum.photos.length, 1);
    assert.equal(freshAlbum.photos[0].filename, "A.jpg");
    assert.equal(freshAlbum.photos[0].caption, "Original");
    assert.deepEqual(freshAlbum.photos[0].tags, [{ name: "白馬岳", x: 10, y: 20 }]);
    assert.deepEqual(freshTagged[0].tags, freshAlbum.photos[0].tags);

    const diagnosticCatalog = createAlbumCatalog([
        record("yama/diagnostic-copy", manifest({
            title: "Diagnostic copy",
            order: 10,
            photos: [{ filename: "A.jpg" }, { filename: "unused.jpg" }],
        }), ["A.jpg"]),
    ]);
    diagnosticCatalog.diagnostics[0].code = "mutated-diagnostic";
    assert.equal(diagnosticCatalog.diagnostics[0].code, "manifest-photo-not-in-mdx");
});

test("produces identical winners, Albums, and diagnostics for record permutations", () => {
    const canonicalDuplicate = record("yama/duplicate-order", manifest({
        title: "Canonical duplicate",
        order: 10,
        photos: [{ filename: "A.jpg" }, { filename: "unused-A.jpg" }],
    }), ["A.jpg"]);
    canonicalDuplicate.manifestPath = "src/content/albums/yama/a-duplicate.album.json";
    canonicalDuplicate.mdxPath = "src/content/albums/yama/a-duplicate.mdx";

    const losingDuplicate = record("yama/duplicate-order", manifest({
        title: "Losing duplicate",
        order: 30,
        photos: [{ filename: "Z.jpg" }],
    }), ["Z.jpg"]);
    losingDuplicate.manifestPath = "src/content/albums/yama/z-duplicate.album.json";
    losingDuplicate.mdxPath = "src/content/albums/yama/z-duplicate.mdx";

    const orderCollision = record("yama/order-collision", manifest({
        title: "Order collision",
        order: 10,
        photos: [{ filename: "B.jpg" }, { filename: "unused-B.jpg" }],
    }), ["B.jpg"]);

    const records = [orderCollision, losingDuplicate, canonicalDuplicate];
    const forward = createAlbumCatalog(records);
    const reverse = createAlbumCatalog([...records].reverse());

    assert.equal(forward.getAlbum("yama/duplicate-order").title, "Canonical duplicate");
    assert.deepEqual(reverse.getAlbums(), forward.getAlbums());
    assert.deepEqual(reverse.diagnostics, forward.diagnostics);
    assert.deepEqual(forward.diagnostics.map(({ code }) => code).sort(), [
        "duplicate-album-order",
        "duplicate-album-slug",
        "manifest-photo-not-in-mdx",
        "manifest-photo-not-in-mdx",
    ]);
});
