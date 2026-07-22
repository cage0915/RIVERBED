import assert from "node:assert/strict";
import test from "node:test";

import { convertLegacyAlbum } from "./legacy-source.js";

function fixture(overrides = {}) {
    return {
        albumSlug: "yama/hakuba",
        mdxPath: "src/content/albums/yama/hakuba.mdx",
        mdxSource: `---
title: "白馬"
publishedAt: 2026-02-01
coverKey: "A.jpg"
coverZoom: 1
coverOffset: { x: 50, y: 30 }
---

<Row><Photo itemKey="A.jpg" /></Row>
`,
        order: 20,
        tags: {
            "A.jpg": [{ name: "白馬岳", x: 50, y: 25 }],
        },
        trackedAlbumPhotos: new Set([
            "yama/hakuba/A.jpg",
            "yama/source/shared.jpg",
        ]),
        ...overrides,
    };
}

test("converts supported legacy fields, local photos, tags, and order deterministically", () => {
    assert.deepEqual(convertLegacyAlbum(fixture()), {
        schemaVersion: 1,
        title: "白馬",
        publishedAt: "2026-02-01",
        order: 20,
        cover: {
            photo: { kind: "local", filename: "A.jpg" },
            zoom: 1,
            offset: { x: 50, y: 30 },
        },
        photos: [{
            filename: "A.jpg",
            tags: [{ name: "白馬岳", x: 50, y: 25 }],
        }],
    });
});

test("normalizes full legacy tag keys and preserves supported optional metadata", () => {
    const input = fixture({
        mdxSource: `---
title: '白馬'
info: '2026.2'
publishedAt: "2026-02-01"
coverKey: 'A.jpg'
coverZoom: 1.25
coverOffset: { x: 45.5, y: 30 }
gap: "2rem"
---

<Photo itemKey="A.jpg" caption="ridge" />
`,
        tags: {
            "/yama/hakuba/A.jpg": [{ name: "白馬岳", x: 50, y: 25 }],
        },
    });

    assert.deepEqual(convertLegacyAlbum(input), {
        schemaVersion: 1,
        title: "白馬",
        info: "2026.2",
        publishedAt: "2026-02-01",
        order: 20,
        gap: "2rem",
        cover: {
            photo: { kind: "local", filename: "A.jpg" },
            zoom: 1.25,
            offset: { x: 45.5, y: 30 },
        },
        photos: [{
            filename: "A.jpg",
            caption: "ridge",
            tags: [{ name: "白馬岳", x: 50, y: 25 }],
        }],
    });
});

test("preserves a multiline static caption containing greater-than text regardless of attribute order", () => {
    const input = fixture({
        mdxSource: fixture().mdxSource.replace(
            '<Row><Photo itemKey="A.jpg" /></Row>',
            `<Row><Photo
  caption="left > right"
  itemKey="A.jpg"
/></Row>`,
        ),
    });

    assert.equal(convertLegacyAlbum(input).photos[0].caption, "left > right");
});

test("converts a tracked photo from another Album into an external cover", () => {
    const input = fixture({
        mdxSource: fixture().mdxSource.replace('coverKey: "A.jpg"', 'coverKey: "yama/source/shared.jpg"'),
    });

    assert.deepEqual(convertLegacyAlbum(input).cover.photo, {
        kind: "external",
        assetKey: "yama/source/shared.jpg",
    });
});

test("keeps an unreferenced selected local cover as the only manifest-only inventory photo", () => {
    const input = fixture({
        mdxSource: fixture().mdxSource
            .replace('coverKey: "A.jpg"', 'coverKey: "cover.jpg"'),
        trackedAlbumPhotos: new Set([
            "yama/hakuba/A.jpg",
            "yama/hakuba/cover.jpg",
        ]),
    });

    assert.deepEqual(convertLegacyAlbum(input).photos.map(({ filename }) => filename), [
        "A.jpg",
        "cover.jpg",
    ]);
});

test("rejects stale tag keys", () => {
    assert.throws(
        () => convertLegacyAlbum(fixture({ tags: { "stale.jpg": [] } })),
        /stale tag key.*stale\.jpg/i,
    );
});

test("rejects cross-Album MDX content references", () => {
    assert.throws(
        () => convertLegacyAlbum(fixture({
            mdxSource: fixture().mdxSource.replace(
                'itemKey="A.jpg"',
                'itemKey="yama/source/shared.jpg"',
            ),
        })),
        /local filename|cross-Album/i,
    );
});

test("rejects unsupported or malformed frontmatter instead of guessing", () => {
    assert.throws(
        () => convertLegacyAlbum(fixture({
            mdxSource: fixture().mdxSource.replace(
                'coverZoom: 1',
                'coverZoom: dynamic\nunknown: value',
            ),
        })),
        /frontmatter/i,
    );
});

test("applies the current content schema defaults to omitted legacy cover crop fields", () => {
    const input = fixture({
        mdxSource: fixture().mdxSource
            .replace("coverZoom: 1\n", "")
            .replace("coverOffset: { x: 50, y: 30 }\n", ""),
    });

    assert.deepEqual(convertLegacyAlbum(input).cover, {
        photo: { kind: "local", filename: "A.jpg" },
        zoom: 1,
        offset: { x: 50, y: 50 },
    });
});
