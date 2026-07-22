import assert from "node:assert/strict";
import test from "node:test";

import { validateAlbumInventory } from "./validation.ts";

function manifest(filenames, cover = { kind: "local", filename: filenames[0] }) {
    return {
        schemaVersion: 1,
        title: "Walk",
        order: 1,
        cover: {
            photo: cover,
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        photos: filenames.map((filename) => ({ filename, tags: [] })),
    };
}

function validate({ filenames, mdxBody, cover }) {
    return validateAlbumInventory({
        albumSlug: "yama/walk",
        manifestPath: "src/content/albums/yama/walk.album.json",
        manifest: manifest(filenames, cover),
        mdxPath: "src/content/albums/yama/walk.mdx",
        mdxBody,
    });
}

test("turns MDX Photo syntax errors into a stable diagnostic", () => {
    const diagnostics = validate({
        filenames: ["A.jpg"],
        mdxBody: `<Photo itemKey={key} />`,
    });

    assert.equal(diagnostics.length, 1);
    assert.deepEqual(
        {
            code: diagnostics[0].code,
            albumSlug: diagnostics[0].albumSlug,
            sourcePath: diagnostics[0].sourcePath,
            manifestPath: diagnostics[0].manifestPath,
            fieldPath: diagnostics[0].fieldPath,
        },
        {
            code: "mdx-photo-syntax",
            albumSlug: "yama/walk",
            sourcePath: "src/content/albums/yama/walk.mdx",
            manifestPath: "src/content/albums/yama/walk.album.json",
            fieldPath: "Photo@0",
        },
    );
    assert.match(diagnostics[0].message, /static quoted string/i);
});

test("reports duplicate MDX Photo references", () => {
    const diagnostics = validate({
        filenames: ["A.jpg"],
        mdxBody: `<Photo itemKey="A.jpg" />\n<Photo itemKey='A.jpg' />`,
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["duplicate-mdx-photo"]);
    assert.equal(diagnostics[0].sourcePath, "src/content/albums/yama/walk.mdx");
    assert.match(diagnostics[0].fieldPath, /^Photo@\d+$/);
    assert.match(diagnostics[0].message, /A\.jpg/);
});

test("reports an MDX Photo missing from the manifest", () => {
    const diagnostics = validate({
        filenames: ["A.jpg"],
        mdxBody: `<Photo itemKey="A.jpg" />\n<Photo itemKey="B.jpg" />`,
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["mdx-photo-missing-from-manifest"]);
    assert.equal(diagnostics[0].sourcePath, "src/content/albums/yama/walk.mdx");
    assert.match(diagnostics[0].message, /B\.jpg.*manifest/i);
});

test("reports manifest-only photos that are not the selected local cover", () => {
    const diagnostics = validate({
        filenames: ["A.jpg", "unused.jpg"],
        mdxBody: `<Photo itemKey="A.jpg" />`,
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["manifest-photo-not-in-mdx"]);
    assert.equal(diagnostics[0].sourcePath, "src/content/albums/yama/walk.album.json");
    assert.equal(diagnostics[0].fieldPath, "photos[1].filename");
});

test("allows exactly the selected local cover to be manifest-only", () => {
    const diagnostics = validate({
        filenames: ["cover.jpg", "A.jpg"],
        cover: { kind: "local", filename: "cover.jpg" },
        mdxBody: `<Photo itemKey="A.jpg" />`,
    });

    assert.deepEqual(diagnostics, []);
});

test("an external cover does not excuse unused local inventory", () => {
    const diagnostics = validate({
        filenames: ["A.jpg", "unused.jpg"],
        cover: { kind: "external", assetKey: "yama/other/cover.jpg" },
        mdxBody: `<Photo itemKey="A.jpg" />`,
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["manifest-photo-not-in-mdx"]);
    assert.match(diagnostics[0].message, /unused\.jpg/);
});

test("reports when manifest content order differs from MDX order", () => {
    const diagnostics = validate({
        filenames: ["B.jpg", "A.jpg"],
        cover: { kind: "local", filename: "B.jpg" },
        mdxBody: `<Photo itemKey="A.jpg" />\n<Photo itemKey="B.jpg" />`,
    });

    assert.deepEqual(diagnostics.map(({ code }) => code), ["manifest-photo-order-mismatch"]);
    assert.equal(diagnostics[0].sourcePath, "src/content/albums/yama/walk.album.json");
    assert.equal(diagnostics[0].fieldPath, "photos");
    assert.match(diagnostics[0].message, /A\.jpg.*B\.jpg/);
});

test("returns no diagnostics for matching MDX and manifest inventory", () => {
    const diagnostics = validate({
        filenames: ["A.jpg", "B.jpg"],
        mdxBody: `<Row>\n<Photo itemKey="A.jpg" />\n<Photo itemKey='B.jpg' />\n</Row>`,
    });

    assert.deepEqual(diagnostics, []);
});
