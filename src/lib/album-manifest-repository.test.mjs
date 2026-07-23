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
import {
    runValidationCli,
    validateAlbumRepository,
} from "../../scripts/validate-album-repository.mjs";

const migrationScript = fileURLToPath(new URL("../../scripts/migrate-album-manifests.mjs", import.meta.url));
const validationScript = fileURLToPath(new URL("../../scripts/validate-album-repository.mjs", import.meta.url));

function write(root, relativePath, content) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
}

function filesBelow(root, relativeRoot, predicate = () => true) {
    const absoluteRoot = path.join(root, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) return [];
    return fs.readdirSync(absoluteRoot, { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile())
        .map((entry) => path.join(entry.parentPath, entry.name))
        .filter(predicate)
        .sort();
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

function createCutoverRepository() {
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    writeAlbumManifests(plan);
    for (const { mdxPath, mdxBody } of plan.candidates) {
        fs.writeFileSync(mdxPath, `---\n---\n${mdxBody}`);
    }
    fs.rmSync(path.join(root, "src/album-tags"), { recursive: true });
    for (const orderPath of filesBelow(root, "src/content/albums", (entry) => path.basename(entry) === "_order.json")) {
        fs.unlinkSync(orderPath);
    }
    return root;
}

function diagnosticLocations(diagnostics) {
    return diagnostics.map(({ code, albumSlug, sourcePath, manifestPath, fieldPath }) => ({
        code, albumSlug, sourcePath, manifestPath, fieldPath,
    }));
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
        validate: "node scripts/validate-album-repository.mjs",
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

    assert.doesNotMatch(albumPage, /albumEntry\.data\.(?:title|info|gap)/);
    for (const field of ["title", "info", "gap"]) {
        assert.match(albumPage, new RegExp(`albumRecord\\.${field}`));
    }
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

test("production catalog pairs every minimal MDX with one validated manifest", async () => {
    const projectRoot = path.resolve(path.dirname(migrationScript), "..");
    const catalogPath = path.join(projectRoot, "src/lib/albums/catalog.ts");

    assert.ok(fs.existsSync(catalogPath), "Astro catalog adapter must exist");
    const { validateAlbumRepository } = await import(validationScript);
    assert.deepEqual(validateAlbumRepository(projectRoot), {
        albumCount: 67,
        validCount: 67,
        diagnostics: [],
    });
    const externalCover = JSON.parse(fs.readFileSync(
        path.join(projectRoot, "src/album-manifests/yama/2025-omoteginza-d3.json"),
        "utf8",
    ));
    assert.deepEqual(externalCover.cover.photo, {
        kind: "external",
        assetKey: "yama/2025-omoteginza-d2/KCS06809.jpg",
    });

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

test("cleanup mode preserves MDX bodies byte-for-byte and retires Album frontmatter", async () => {
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    writeAlbumManifests(plan);
    const bodies = new Map(plan.candidates.map(({ mdxPath, mdxBody }) => [mdxPath, mdxBody]));
    const { runMigrationCli } = await import(migrationScript);
    const output = [];
    const errors = [];

    assert.equal(runMigrationCli({
        mode: "cleanup",
        projectRoot: root,
        stdout: (message) => output.push(message),
        stderr: (message) => errors.push(message),
    }), 0);
    assert.deepEqual(errors, []);
    assert.match(output.join("\n"), /2 MDX files cleaned/);
    for (const [mdxPath, body] of bodies) {
        assert.equal(fs.readFileSync(mdxPath, "utf8"), `---\n---\n${body}`);
    }
});

test("repository contains no retired Album storage or mutable Album frontmatter", () => {
    const projectRoot = path.resolve(path.dirname(migrationScript), "..");
    const retired = [
        ...filesBelow(projectRoot, "src/album-tags", (entry) => entry.endsWith(".json")),
        ...filesBelow(projectRoot, "src/content/albums", (entry) => path.basename(entry) === "_order.json"),
    ];
    assert.deepEqual(retired, []);

    const forbiddenFields = /^(?:title|coverKey|coverZoom|coverOffset|publishedAt|info|order|gap):/m;
    for (const mdxPath of filesBelow(projectRoot, "src/content/albums", (entry) => entry.endsWith(".mdx"))) {
        const source = fs.readFileSync(mdxPath, "utf8");
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(source)?.[1] ?? "";
        assert.doesNotMatch(frontmatter, forbiddenFields, path.relative(projectRoot, mdxPath));
    }
});

test("post-cutover configuration validates manifests before contour preparation", () => {
    const projectRoot = path.resolve(path.dirname(migrationScript), "..");
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const contentConfig = fs.readFileSync(path.join(projectRoot, "src/content/config.ts"), "utf8");

    assert.match(contentConfig, /schema:\s*z\.object\(\{\}\)\.strict\(\)/);
    assert.doesNotMatch(contentConfig, /title|coverKey|publishedAt|coverZoom|coverOffset|\border\b|\bgap\b/);
    assert.equal(packageJson.scripts.prebuild, "node scripts/validate-album-repository.mjs && node scripts/prepare-contour-assets.mjs prepare");
    assert.equal(packageJson.scripts["albums:validate"], "node scripts/validate-album-repository.mjs");
});

test("post-cutover validator reads only paired manifests and minimal MDX", async () => {
    const root = createRepository();
    writeAlbumManifests(createLegacyMigrationPlan(root));
    const { runMigrationCli } = await import(migrationScript);
    assert.equal(runMigrationCli({ mode: "cleanup", projectRoot: root, stdout: () => {}, stderr: () => {} }), 0);
    fs.rmSync(path.join(root, "src/album-tags"), { recursive: true });
    for (const orderPath of filesBelow(root, "src/content/albums", (entry) => path.basename(entry) === "_order.json")) {
        fs.unlinkSync(orderPath);
    }

    assert.ok(fs.existsSync(validationScript));
    const { validateAlbumRepository } = await import(validationScript);
    assert.deepEqual(validateAlbumRepository(root), {
        albumCount: 2,
        validCount: 2,
        diagnostics: [],
    });
});

test("post-cutover validator accumulates retired storage with deterministic attribution", () => {
    const root = createCutoverRepository();
    const tagsPath = path.join(root, "src/album-tags/yama/source.json");
    const orderPath = path.join(root, "src/content/albums/yama/_order.json");
    write(root, "src/album-tags/yama/source.json", "{}");
    write(root, "src/content/albums/yama/_order.json", "[]");

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 1,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "retired-album-order-file",
            albumSlug: "yama/*",
            sourcePath: orderPath,
            manifestPath: path.join(root, "src/album-manifests/yama"),
            fieldPath: "order",
        },
        {
            code: "retired-album-tag-sidecar",
            albumSlug: "yama/source",
            sourcePath: tagsPath,
            manifestPath: path.join(root, "src/album-manifests/yama/source.json"),
            fieldPath: "tags",
        },
    ]);
    assert.deepEqual(validateAlbumRepository(root), result);
});

test("post-cutover validator reports missing and orphan manifest pairs together", () => {
    const root = createCutoverRepository();
    const missingPath = path.join(root, "src/album-manifests/yama/consumer.json");
    const orphanPath = path.join(root, "src/album-manifests/yama/orphan.json");
    fs.unlinkSync(missingPath);
    fs.copyFileSync(path.join(root, "src/album-manifests/yama/source.json"), orphanPath);

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 1,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "missing-album-manifest",
            albumSlug: "yama/consumer",
            sourcePath: missingPath,
            manifestPath: missingPath,
            fieldPath: "manifest",
        },
        {
            code: "orphan-album-manifest",
            albumSlug: "yama/orphan",
            sourcePath: orphanPath,
            manifestPath: orphanPath,
            fieldPath: "slug",
        },
    ]);
});

test("post-cutover validator parses invalid MDX even when its manifest is missing", () => {
    const root = createCutoverRepository();
    const mdxPath = path.join(root, "src/content/albums/yama/consumer.mdx");
    const manifestPath = path.join(root, "src/album-manifests/yama/consumer.json");
    fs.unlinkSync(manifestPath);
    fs.writeFileSync(mdxPath, `---\n---\n\n<Photo itemKey={dynamic} />\n`);

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 1,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "missing-album-manifest",
            albumSlug: "yama/consumer",
            sourcePath: manifestPath,
            manifestPath,
            fieldPath: "manifest",
        },
        {
            code: "mdx-photo-syntax",
            albumSlug: "yama/consumer",
            sourcePath: mdxPath,
            manifestPath,
            fieldPath: "Photo@1",
        },
    ]);
});

test("post-cutover validator parses an invalid orphan manifest without MDX", () => {
    const root = createCutoverRepository();
    const orphanPath = path.join(root, "src/album-manifests/yama/orphan.json");
    fs.writeFileSync(orphanPath, "{}");

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 2,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "invalid-album-manifest",
            albumSlug: "yama/orphan",
            sourcePath: orphanPath,
            manifestPath: orphanPath,
            fieldPath: "manifest",
        },
        {
            code: "orphan-album-manifest",
            albumSlug: "yama/orphan",
            sourcePath: orphanPath,
            manifestPath: orphanPath,
            fieldPath: "slug",
        },
    ]);
});

test("post-cutover validator attributes invalid MDX independently from a valid manifest", () => {
    const root = createCutoverRepository();
    const mdxPath = path.join(root, "src/content/albums/yama/consumer.mdx");
    const manifestPath = path.join(root, "src/album-manifests/yama/consumer.json");
    fs.writeFileSync(mdxPath, `---\ntitle: "retired"\n---\n\n<Photo itemKey="own.jpg" />\n`);

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 1,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [{
        code: "invalid-album-mdx",
        albumSlug: "yama/consumer",
        sourcePath: mdxPath,
        manifestPath,
        fieldPath: "frontmatter",
    }]);
});

test("post-cutover validator attributes an invalid manifest independently from valid MDX", () => {
    const root = createCutoverRepository();
    const mdxPath = path.join(root, "src/content/albums/yama/consumer.mdx");
    const manifestPath = path.join(root, "src/album-manifests/yama/consumer.json");
    fs.writeFileSync(manifestPath, "{}");

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 1,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [{
        code: "invalid-album-manifest",
        albumSlug: "yama/consumer",
        sourcePath: manifestPath,
        manifestPath,
        fieldPath: "manifest",
    }]);
    assert.ok(fs.readFileSync(mdxPath, "utf8").startsWith("---\n---\n"));
});

test("post-cutover validator reports MDX syntax and manifest failures for the same slug", () => {
    const root = createCutoverRepository();
    const mdxPath = path.join(root, "src/content/albums/yama/consumer.mdx");
    const manifestPath = path.join(root, "src/album-manifests/yama/consumer.json");
    fs.writeFileSync(mdxPath, `---\n---\n\n<Photo itemKey={dynamic} />\n`);
    fs.writeFileSync(manifestPath, "{");

    assert.deepEqual(diagnosticLocations(validateAlbumRepository(root).diagnostics), [
        {
            code: "invalid-album-manifest",
            albumSlug: "yama/consumer",
            sourcePath: manifestPath,
            manifestPath,
            fieldPath: "manifest",
        },
        {
            code: "mdx-photo-syntax",
            albumSlug: "yama/consumer",
            sourcePath: mdxPath,
            manifestPath,
            fieldPath: "Photo@1",
        },
    ]);
});

test("post-cutover validator runs catalog diagnostics alongside preflight diagnostics", () => {
    const root = createCutoverRepository();
    const tagsPath = path.join(root, "src/album-tags/yama/consumer.json");
    const sourceManifestPath = path.join(root, "src/album-manifests/yama/source.json");
    const consumerManifestPath = path.join(root, "src/album-manifests/yama/consumer.json");
    write(root, "src/album-tags/yama/consumer.json", "{}");
    const consumer = JSON.parse(fs.readFileSync(consumerManifestPath, "utf8"));
    consumer.order = 10;
    fs.writeFileSync(consumerManifestPath, JSON.stringify(consumer));

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 0,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "retired-album-tag-sidecar",
            albumSlug: "yama/consumer",
            sourcePath: tagsPath,
            manifestPath: consumerManifestPath,
            fieldPath: "tags",
        },
        {
            code: "duplicate-album-order",
            albumSlug: "yama/source",
            sourcePath: sourceManifestPath,
            manifestPath: sourceManifestPath,
            fieldPath: "order",
        },
    ]);
});

test("post-cutover validator keeps safe manifest-global checks when MDX is invalid", () => {
    const root = createCutoverRepository();
    const sourceMdxPath = path.join(root, "src/content/albums/yama/source.mdx");
    const sourceManifestPath = path.join(root, "src/album-manifests/yama/source.json");
    const consumerManifestPath = path.join(root, "src/album-manifests/yama/consumer.json");
    fs.writeFileSync(sourceMdxPath, "missing frontmatter");
    const consumer = JSON.parse(fs.readFileSync(consumerManifestPath, "utf8"));
    consumer.order = 10;
    fs.writeFileSync(consumerManifestPath, JSON.stringify(consumer));

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, {
        albumCount: 2,
        validCount: 1,
    });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "duplicate-album-order",
            albumSlug: "yama/source",
            sourcePath: sourceManifestPath,
            manifestPath: sourceManifestPath,
            fieldPath: "order",
        },
        {
            code: "invalid-album-mdx",
            albumSlug: "yama/source",
            sourcePath: sourceMdxPath,
            manifestPath: sourceManifestPath,
            fieldPath: "frontmatter",
        },
    ]);
    assert.equal(result.diagnostics.some(({ code }) => code === "external-cover-source-missing"), false);
});

test("repository validator rejects missing and empty required source roots through the CLI", async () => {
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-roots-missing-"));
    const missing = validateAlbumRepository(missingRoot);
    assert.deepEqual(missing.diagnostics.map(({ code }) => code), [
        "missing-album-manifest-root",
        "missing-album-mdx-root",
    ]);

    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-roots-empty-"));
    fs.mkdirSync(path.join(emptyRoot, "src/content/albums"), { recursive: true });
    fs.mkdirSync(path.join(emptyRoot, "src/album-manifests"), { recursive: true });
    const empty = validateAlbumRepository(emptyRoot);
    assert.deepEqual(empty.diagnostics.map(({ code }) => code), ["empty-album-repository"]);

    const errors = [];
    assert.equal(runValidationCli({
        projectRoot: emptyRoot,
        stdout: () => {},
        stderr: (message) => errors.push(message),
    }), 1);
    assert.match(errors.join("\n"), /empty-album-repository/);
});

test("repository validator reports source symlinks without following them", () => {
    const cases = [
        { relativePath: "src/content/albums/yama/linked.mdx", targetKind: "file" },
        { relativePath: "src/album-manifests/yama/linked.json", targetKind: "file" },
        { relativePath: "src/content/albums/linked", targetKind: "directory" },
    ];
    for (const item of cases) {
        const root = createCutoverRepository();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "album-symlink-outside-"));
        const target = item.targetKind === "directory" ? outside : path.join(outside, "outside.mdx");
        if (item.targetKind === "file") fs.writeFileSync(target, "outside");
        const linkPath = path.join(root, item.relativePath);
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(target, linkPath, item.targetKind === "directory" ? "dir" : "file");

        const result = validateAlbumRepository(root);
        const unsafe = result.diagnostics.filter(({ code }) => code === "unsafe-album-source-entry");
        assert.equal(unsafe.length, 1, item.relativePath);
        assert.equal(unsafe[0].sourcePath, linkPath);
        assert.match(unsafe[0].message, /symbolic link/i);
        assert.equal(result.diagnostics.some(({ sourcePath }) => sourcePath.startsWith(outside)), false);
        const errors = [];
        assert.equal(runValidationCli({
            projectRoot: root,
            stdout: () => {},
            stderr: (message) => errors.push(message),
        }), 1);
        assert.match(errors.join("\n"), /unsafe-album-source-entry/);
    }
});

test("repository validator rejects derived slugs outside the two-segment contract", () => {
    const root = createCutoverRepository();
    write(root, "src/content/albums/yama/nested/album.mdx", "---\n---\n");
    write(root, "src/album-manifests/yama/nested/album.json", "{}");
    write(root, "src/content/albums/yama/Bad.mdx", "---\n---\n");
    write(root, "src/album-manifests/yama/Bad.json", "{}");

    const diagnostics = validateAlbumRepository(root).diagnostics
        .filter(({ code }) => code === "invalid-album-slug");
    assert.equal(diagnostics.length, 4);
    assert.deepEqual(diagnostics.map(({ albumSlug }) => albumSlug), [
        "yama/Bad",
        "yama/Bad",
        "yama/nested/album",
        "yama/nested/album",
    ]);
    assert.equal(diagnostics.some(({ code }) => code === "missing-album-manifest"), false);
    assert.equal(diagnostics.some(({ code }) => code === "orphan-album-manifest"), false);
});

test("cleanup transaction rolls back injected stage-write and commit-rename failures", async () => {
    const { cleanupAlbumMdxTransaction } = await import(migrationScript);
    for (const failure of ["write", "rename"]) {
        const root = createRepository();
        const plan = createLegacyMigrationPlan(root);
        writeAlbumManifests(plan);
        const originals = new Map(plan.candidates.map(({ mdxPath }) => [mdxPath, fs.readFileSync(mdxPath)]));
        let writes = 0;
        let renames = 0;
        const operations = {
            ...fs,
            writeFileSync(...args) {
                writes += 1;
                if (failure === "write" && writes === 2) throw new Error("injected write failure");
                return fs.writeFileSync(...args);
            },
            renameSync(...args) {
                renames += 1;
                if (failure === "rename" && renames === 3) throw new Error("injected rename failure");
                return fs.renameSync(...args);
            },
        };

        assert.throws(() => cleanupAlbumMdxTransaction(plan, operations), new RegExp(`injected ${failure} failure`));
        for (const [mdxPath, source] of originals) {
            assert.deepEqual(fs.readFileSync(mdxPath), source, `${failure}: ${mdxPath}`);
        }
        assert.deepEqual(filesBelow(root, "src/content/albums", (entry) => /\.cleanup-.*\.(?:tmp|bak)$/.test(entry)), []);
    }
});

test("cleanup transaction preserves an explicit recovery backup when rollback fails", async () => {
    const { cleanupAlbumMdxTransaction } = await import(migrationScript);
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    writeAlbumManifests(plan);
    const original = fs.readFileSync(plan.candidates[0].mdxPath);
    let renames = 0;
    const operations = {
        ...fs,
        renameSync(...args) {
            renames += 1;
            if (renames === 3) throw new Error("injected commit failure");
            if (renames === 4) throw new Error("injected rollback failure");
            return fs.renameSync(...args);
        },
    };

    assert.throws(
        () => cleanupAlbumMdxTransaction(plan, operations),
        (error) => error instanceof AggregateError && /recovery artifacts were preserved/i.test(error.message),
    );
    const backups = filesBelow(root, "src/content/albums", (entry) => /\.cleanup-.*\.bak$/.test(entry));
    const temps = filesBelow(root, "src/content/albums", (entry) => /\.cleanup-.*\.tmp$/.test(entry));
    assert.equal(backups.length, 1);
    assert.deepEqual(temps, []);
    fs.renameSync(backups[0], plan.candidates[0].mdxPath);
    assert.deepEqual(fs.readFileSync(plan.candidates[0].mdxPath), original);
});

test("cleanup transaction rejects frontmatter or body changes after final plan creation", async () => {
    const { cleanupAlbumMdxTransaction } = await import(migrationScript);
    for (const mutation of [
        (source) => source.replace('title: "Source"', 'title: "Changed"'),
        (source) => source.replace('itemKey="content.jpg"', 'itemKey="changed.jpg"'),
    ]) {
        const root = createRepository();
        const plan = createLegacyMigrationPlan(root);
        writeAlbumManifests(plan);
        const target = plan.candidates.find(({ slug }) => slug === "yama/source").mdxPath;
        const changed = mutation(fs.readFileSync(target, "utf8"));
        fs.writeFileSync(target, changed);
        let writes = 0;

        assert.throws(() => cleanupAlbumMdxTransaction(plan, {
            ...fs,
            writeFileSync(...args) {
                writes += 1;
                return fs.writeFileSync(...args);
            },
        }), (error) => error?.code === "album-mdx-source-conflict");
        assert.equal(writes, 0);
        assert.equal(fs.readFileSync(target, "utf8"), changed);
        assert.deepEqual(filesBelow(root, "src/content/albums", (entry) => /\.cleanup-.*\.(?:tmp|bak)$/.test(entry)), []);
    }
});

test("cleanup transaction removes a temp file when write creates it before throwing", async () => {
    const { cleanupAlbumMdxTransaction } = await import(migrationScript);
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    writeAlbumManifests(plan);
    const originals = new Map(plan.candidates.map(({ mdxPath }) => [mdxPath, fs.readFileSync(mdxPath)]));
    let injected = false;

    assert.throws(() => cleanupAlbumMdxTransaction(plan, {
        ...fs,
        writeFileSync(...args) {
            fs.writeFileSync(...args);
            if (!injected) {
                injected = true;
                throw new Error("injected post-write failure");
            }
        },
    }), /injected post-write failure/);
    for (const [mdxPath, source] of originals) assert.deepEqual(fs.readFileSync(mdxPath), source);
    assert.deepEqual(filesBelow(root, "src/content/albums", (entry) => /\.cleanup-.*\.(?:tmp|bak)$/.test(entry)), []);
});

test("cleanup transaction rechecks full MDX bytes after staging and before commit", async () => {
    const { cleanupAlbumMdxTransaction } = await import(migrationScript);
    const root = createRepository();
    const plan = createLegacyMigrationPlan(root);
    writeAlbumManifests(plan);
    const target = plan.candidates[1].mdxPath;
    const changed = fs.readFileSync(target, "utf8").replace("Consumer", "Concurrent change");
    let mutated = false;
    let renames = 0;

    assert.throws(() => cleanupAlbumMdxTransaction(plan, {
        ...fs,
        writeFileSync(...args) {
            const result = fs.writeFileSync(...args);
            if (!mutated) {
                mutated = true;
                fs.writeFileSync(target, changed);
            }
            return result;
        },
        renameSync(...args) {
            renames += 1;
            return fs.renameSync(...args);
        },
    }), (error) => error?.code === "album-mdx-source-conflict");
    assert.equal(renames, 0);
    assert.equal(fs.readFileSync(target, "utf8"), changed);
    assert.deepEqual(filesBelow(root, "src/content/albums", (entry) => /\.cleanup-.*\.(?:tmp|bak)$/.test(entry)), []);
});

test("repository validator safely rejects symlinks in retired tag storage", () => {
    const rootSymlinkProject = createCutoverRepository();
    const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "retired-tags-outside-"));
    fs.writeFileSync(path.join(outsideRoot, "outside.json"), "{}");
    fs.symlinkSync(outsideRoot, path.join(rootSymlinkProject, "src/album-tags"), "dir");
    const rootResult = validateAlbumRepository(rootSymlinkProject);
    assert.deepEqual(rootResult.diagnostics.map(({ code }) => code), ["unsafe-retired-storage"]);

    const innerSymlinkProject = createCutoverRepository();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "retired-tags-entry-outside-"));
    const outsideFile = path.join(outside, "outside.json");
    fs.writeFileSync(outsideFile, "{}");
    fs.mkdirSync(path.join(innerSymlinkProject, "src/album-tags/yama"), { recursive: true });
    fs.symlinkSync(outsideFile, path.join(innerSymlinkProject, "src/album-tags/yama/file.json"), "file");
    fs.symlinkSync(outside, path.join(innerSymlinkProject, "src/album-tags/linked"), "dir");
    const innerResult = validateAlbumRepository(innerSymlinkProject);
    const unsafe = innerResult.diagnostics.filter(({ code }) => code === "unsafe-retired-storage");
    assert.equal(unsafe.length, 2);
    assert.equal(innerResult.diagnostics.some(({ sourcePath }) => sourcePath.startsWith(outside)), false);
    const errors = [];
    assert.equal(runValidationCli({
        projectRoot: innerSymlinkProject,
        stdout: () => {},
        stderr: (message) => errors.push(message),
    }), 1);
    assert.match(errors.join("\n"), /unsafe-retired-storage/);
});

test("retired Album frontmatter writers and compatibility route are absent", () => {
    const projectRoot = path.resolve(path.dirname(migrationScript), "..");
    const pageStructure = fs.readFileSync(path.join(projectRoot, "src/lib/page-structure.ts"), "utf8");
    const albumImport = fs.readFileSync(path.join(projectRoot, "src/lib/album-import.js"), "utf8");
    const routes = fs.readFileSync(path.join(projectRoot, "src/integrations/dev-api-routes.mjs"), "utf8");

    assert.doesNotMatch(pageStructure, /createPageContent|frontmatter/);
    assert.doesNotMatch(albumImport, /createAlbumMdx|coverKey:/);
    assert.doesNotMatch(routes, /save-page-structure/);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/dev-api/save-page-structure.ts")), false);
});
