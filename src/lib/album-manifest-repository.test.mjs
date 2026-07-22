import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    createLegacyMigrationPlan,
    validateAlbumManifests,
    writeAlbumManifests,
} from "./albums/legacy-source.js";

const migrationScript = fileURLToPath(new URL("../../scripts/migrate-album-manifests.mjs", import.meta.url));

function write(root, relativePath, content) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function createRepository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-manifest-migration-"));
    write(root, "src/content/albums/yama/_order.json", JSON.stringify(["source", "consumer"]));
    write(root, "src/content/albums/yama/source.mdx", `---
title: "Source"
coverKey: "cover.jpg"
coverZoom: 1
coverOffset: { x: 50, y: 50 }
---

<Photo
  caption="left > right"
  itemKey="content.jpg"
/>
`);
    write(root, "src/album-tags/yama/source.json", JSON.stringify({
        "yama/source/content.jpg": [{ name: "Peak", x: 25, y: 75 }],
    }));
    write(root, "src/content/albums/yama/consumer.mdx", `---
title: "Consumer"
info: "External cover"
coverKey: "yama/source/content.jpg"
coverZoom: 1.2
coverOffset: { x: 40, y: 60 }
---

<Photo itemKey="own.jpg" />
`);
    return root;
}

test("plans deterministic parallel-root manifests without writing", () => {
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);

    assert.deepEqual(plan.diagnostics, []);
    assert.deepEqual(plan.candidates.map(({ slug, manifestPath }) => ({
        slug,
        manifestPath: path.relative(root, manifestPath).split(path.sep).join("/"),
    })), [
        { slug: "yama/source", manifestPath: "src/album-manifests/yama/source.json" },
        { slug: "yama/consumer", manifestPath: "src/album-manifests/yama/consumer.json" },
    ]);
    assert.equal(plan.candidates[0].manifest.order, 10);
    assert.equal(plan.candidates[0].manifest.photos[0].caption, "left > right");
    assert.equal(plan.candidates[0].manifest.photos[1].filename, "cover.jpg");
    assert.deepEqual(plan.candidates[1].manifest.cover.photo, {
        kind: "external",
        assetKey: "yama/source/content.jpg",
    });
    assert.ok(plan.candidates.every(({ manifestPath }) => !fs.existsSync(manifestPath)));
});

test("writes two-space JSON with a trailing newline and validates equivalence", () => {
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);

    assert.deepEqual(writeAlbumManifests(plan), { written: 2, unchanged: 0 });
    const source = fs.readFileSync(plan.candidates[0].manifestPath, "utf8");
    assert.equal(source, `${JSON.stringify(plan.candidates[0].manifest, null, 2)}\n`);
    assert.deepEqual(validateAlbumManifests(root), {
        albumCount: 2,
        equivalentCount: 2,
        diagnostics: [],
    });

    assert.deepEqual(writeAlbumManifests(createLegacyMigrationPlan(root)), {
        written: 0,
        unchanged: 2,
    });
});

test("refuses to overwrite a non-equivalent existing manifest", () => {
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    fs.mkdirSync(path.dirname(plan.candidates[0].manifestPath), { recursive: true });
    fs.writeFileSync(plan.candidates[0].manifestPath, JSON.stringify({ wrong: true }));

    assert.throws(() => writeAlbumManifests(plan), /refus.*non-equivalent/i);
});

test("reports stale tags and performs no partial writes", () => {
    const root = createRepository();
    write(root, "src/album-tags/yama/consumer.json", JSON.stringify({ "stale.jpg": [] }));
    const plan = createLegacyMigrationPlan(root);

    assert.deepEqual(plan.diagnostics, [{
        code: "legacy-tag-stale",
        message: "Stale tag key: stale.jpg",
        albumSlug: "yama/consumer",
        sourcePath: path.join(root, "src/album-tags/yama/consumer.json"),
        manifestPath: path.join(root, "src/album-manifests/yama/consumer.json"),
        fieldPath: 'tags["stale.jpg"]',
    }]);
    assert.throws(() => writeAlbumManifests(plan), /diagnostic/i);
    assert.ok(plan.candidates.every(({ manifestPath }) => !fs.existsSync(manifestPath)));
});

test("attributes malformed legacy tag entries to the sidecar with precise fields", () => {
    const cases = [
        {
            tags: { "own.jpg": [{ name: "Peak", x: 50, y: 101 }] },
            code: "legacy-tag-coordinate-invalid",
            fieldPath: 'photos["own.jpg"].tags[0].y',
            message: /between 0 and 100/i,
        },
        {
            tags: { "own.jpg": [{ name: "Peak", x: 50, y: 50, unexpected: true }] },
            code: "legacy-tag-invalid",
            fieldPath: 'photos["own.jpg"].tags[0].unexpected',
            message: /unknown field/i,
        },
    ];

    for (const item of cases) {
        const root = createRepository();
        const tagsPath = path.join(root, "src/album-tags/yama/consumer.json");
        const manifestPath = path.join(root, "src/album-manifests/yama/consumer.json");
        write(root, "src/album-tags/yama/consumer.json", JSON.stringify(item.tags));

        const diagnostics = createLegacyMigrationPlan(root).diagnostics;
        assert.equal(diagnostics.length, 1);
        assert.deepEqual({
            code: diagnostics[0].code,
            albumSlug: diagnostics[0].albumSlug,
            sourcePath: diagnostics[0].sourcePath,
            manifestPath: diagnostics[0].manifestPath,
            fieldPath: diagnostics[0].fieldPath,
        }, {
            code: item.code,
            albumSlug: "yama/consumer",
            sourcePath: tagsPath,
            manifestPath,
            fieldPath: item.fieldPath,
        });
        assert.match(diagnostics[0].message, item.message);
    }
});

test("reverse-enumerates orphan tag and manifest files with stable diagnostics", () => {
    const root = createRepository();
    writeAlbumManifests(createLegacyMigrationPlan(root));
    write(root, "src/album-tags/yama/orphan-tag.json", "{}");
    write(root, "src/album-manifests/yama/orphan-manifest.json", "{}");

    const expected = [
        {
            code: "orphan-album-manifest",
            message: "Album manifest has no matching MDX source",
            albumSlug: "yama/orphan-manifest",
            sourcePath: path.join(root, "src/album-manifests/yama/orphan-manifest.json"),
            manifestPath: path.join(root, "src/album-manifests/yama/orphan-manifest.json"),
            fieldPath: "slug",
        },
        {
            code: "orphan-legacy-tag",
            message: "Legacy tag sidecar has no matching MDX source",
            albumSlug: "yama/orphan-tag",
            sourcePath: path.join(root, "src/album-tags/yama/orphan-tag.json"),
            manifestPath: path.join(root, "src/album-manifests/yama/orphan-tag.json"),
            fieldPath: "slug",
        },
    ];
    assert.deepEqual(createLegacyMigrationPlan(root).diagnostics, expected);
    assert.deepEqual(validateAlbumManifests(root), {
        albumCount: 2,
        equivalentCount: 2,
        diagnostics: expected,
    });
});

test("validate reports a missing paired manifest with the expected Album count", () => {
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    writeAlbumManifests(plan);
    fs.unlinkSync(path.join(root, "src/album-manifests/yama/consumer.json"));

    assert.deepEqual(validateAlbumManifests(root), {
        albumCount: 2,
        equivalentCount: 1,
        diagnostics: [{
            code: "missing-album-manifest",
            message: "Manifest is missing",
            albumSlug: "yama/consumer",
            sourcePath: path.join(root, "src/album-manifests/yama/consumer.json"),
            manifestPath: path.join(root, "src/album-manifests/yama/consumer.json"),
            fieldPath: "manifest",
        }],
    });
});

test("validate rejects unknown persisted keys instead of normalizing them away", () => {
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    writeAlbumManifests(plan);
    const target = path.join(root, "src/album-manifests/yama/source.json");
    const manifest = JSON.parse(fs.readFileSync(target, "utf8"));
    manifest.unexpected = true;
    fs.writeFileSync(target, JSON.stringify(manifest));

    const result = validateAlbumManifests(root);
    assert.equal(result.equivalentCount, 1);
    assert.deepEqual(result.diagnostics.map(({ code, albumSlug, sourcePath, manifestPath, fieldPath }) => ({
        code, albumSlug, sourcePath, manifestPath, fieldPath,
    })), [{
        code: "invalid-album-manifest",
        albumSlug: "yama/source",
        sourcePath: target,
        manifestPath: target,
        fieldPath: "manifest",
    }]);
    assert.match(result.diagnostics[0].message, /unknown field/i);
});

test("CLI runner exposes read-only check, write, and equivalence validate modes", async () => {
    const root = createRepository();
    assert.ok(fs.existsSync(migrationScript));
    const { main, runMigrationCli } = await import(migrationScript);
    const output = [];
    const errors = [];
    const io = {
        projectRoot: root,
        stdout: (message) => output.push(message),
        stderr: (message) => errors.push(message),
    };

    assert.equal(runMigrationCli({ ...io, mode: "check" }), 0);
    assert.match(output.join("\n"), /2\/2 candidate manifests, 0 diagnostics/);
    assert.match(output.join("\n"), /album-manifests\/yama\/source\.json/);
    assert.match(output.join("\n"), /album-manifests\/yama\/consumer\.json/);
    assert.ok(!fs.existsSync(path.join(root, "src/album-manifests/yama/source.json")));

    output.length = 0;
    assert.equal(runMigrationCli({ ...io, mode: "write" }), 0);
    assert.match(output.join("\n"), /2 manifests written/);

    output.length = 0;
    assert.equal(runMigrationCli({ ...io, mode: "validate" }), 0);
    assert.match(output.join("\n"), /2\/2 manifests equivalent, 0 diagnostics/);
    assert.deepEqual(errors, []);

    output.length = 0;
    assert.equal(main(["node", migrationScript, "check"], io), 0);
    assert.match(output.join("\n"), /2\/2 candidate manifests, 0 diagnostics/);

    errors.length = 0;
    assert.equal(main(["node", migrationScript, "unknown"], io), 1);
    assert.match(errors.join("\n"), /usage:.*check\|write\|validate/i);

    const packageJson = JSON.parse(fs.readFileSync(path.join(
        path.dirname(migrationScript), "../package.json",
    ), "utf8"));
    assert.deepEqual({
        check: packageJson.scripts["albums:migrate:check"],
        write: packageJson.scripts["albums:migrate:write"],
        validate: packageJson.scripts["albums:validate"],
    }, {
        check: "node scripts/migrate-album-manifests.mjs check",
        write: "node scripts/migrate-album-manifests.mjs write",
        validate: "node scripts/migrate-album-manifests.mjs validate",
    });
});

test("production Album and Tag rendering read manifests through the catalog", () => {
    const sourceRoot = path.resolve(path.dirname(migrationScript), "../src");
    const albumPage = fs.readFileSync(
        path.join(sourceRoot, "pages/[folder]/[album].astro"),
        "utf8",
    );
    const photoComponent = fs.readFileSync(
        path.join(sourceRoot, "components/Photo.astro"),
        "utf8",
    );
    const albumPhotoComponent = fs.readFileSync(
        path.join(sourceRoot, "components/AlbumPhoto.astro"),
        "utf8",
    );
    const tagPage = fs.readFileSync(
        path.join(sourceRoot, "pages/yama/tags/[tag].astro"),
        "utf8",
    );

    assert.match(albumPage, /AlbumPhoto/);
    assert.doesNotMatch(photoComponent, /album-tags|import\.meta\.glob|Astro\.url\.pathname/);
    assert.match(albumPhotoComponent, /caption=\{photo\.caption\}/);
    assert.match(photoComponent, /photo-caption--photo/);
    assert.match(photoComponent, /<RichText text=\{caption\}/);
    assert.match(tagPage, /caption=\{photo\.caption\}/);
    assert.doesNotMatch(photoComponent, /\bonerror=/);
    assert.match(photoComponent, /data-dev-fallback-url/);
    assert.match(photoComponent, /addEventListener\("error"/);
    assert.match(photoComponent, /\{ once: true \}/);
    assert.match(tagPage, /getTaggedPhotos\(decodedTag\)/);
    assert.match(tagPage, /sourceAlbumSlug/);
    assert.doesNotMatch(tagPage, /getAllPhotosWithTags|utils\/tags/);
    assert.ok(!fs.existsSync(path.join(sourceRoot, "utils/tags.ts")));
});

test("production catalog pairs every MDX with one manifest and preserves legacy summaries", () => {
    const projectRoot = path.resolve(path.dirname(migrationScript), "..");
    const catalogPath = path.join(projectRoot, "src/lib/albums/catalog.ts");

    assert.ok(fs.existsSync(catalogPath), "Astro catalog adapter must exist");

    const plan = createLegacyMigrationPlan(projectRoot);
    assert.deepEqual(plan.diagnostics, []);
    assert.equal(plan.candidates.length, 67);

    const legacySummaries = plan.candidates.map(({ slug, manifest }) => ({
        route: `/${slug}`,
        title: manifest.title,
        order: manifest.order,
        coverKey: manifest.cover.photo.kind === "local"
            ? `${slug}/${manifest.cover.photo.filename}`
            : manifest.cover.photo.assetKey,
        publishedAt: manifest.publishedAt,
    }));
    const manifestSummaries = plan.candidates.map(({ slug, manifestPath }) => {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        return {
            route: `/${slug}`,
            title: manifest.title,
            order: manifest.order,
            coverKey: manifest.cover.photo.kind === "local"
                ? `${slug}/${manifest.cover.photo.filename}`
                : manifest.cover.photo.assetKey,
            publishedAt: manifest.publishedAt,
        };
    });

    assert.deepEqual(manifestSummaries, legacySummaries);
    assert.deepEqual(
        manifestSummaries.find(({ route }) => route === "/yama/2025-omoteginza-d3"),
        {
            route: "/yama/2025-omoteginza-d3",
            title: "表銀座 D3",
            order: 150,
            coverKey: "yama/2025-omoteginza-d2/KCS06809.jpg",
            publishedAt: undefined,
        },
    );

    const catalogSource = fs.readFileSync(catalogPath, "utf8");
    assert.match(catalogSource, /import\.meta\.glob\(\s*["']\/src\/album-manifests\/\*\*\/\*\.json["']/);
    for (const api of ["getAlbumCatalog", "getAlbumSummaries", "getAlbumBySlug", "getTaggedPhotos"]) {
        assert.match(catalogSource, new RegExp(`export\\s+(?:async\\s+)?function\\s+${api}\\b`));
    }
});

test("production catalog readers do not read legacy Album metadata or order files", () => {
    const projectRoot = path.resolve(path.dirname(migrationScript), "..");
    const readers = [
        "src/pages/index.astro",
        "src/pages/[folder]/index.astro",
        "src/layouts/Layout.astro",
        "src/pages/rss.xml.ts",
    ];

    for (const relativePath of readers) {
        const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
        assert.doesNotMatch(source, /_order\.json|\.data\.(?:title|info|publishedAt|coverKey|coverZoom|coverOffset|order|gap)\b/);
        assert.match(source, /lib\/albums\/catalog/);
    }

    const homeSource = fs.readFileSync(path.join(projectRoot, "src/pages/index.astro"), "utf8");
    assert.match(homeSource, /Home page requires at least one Album in the catalog/);
});
