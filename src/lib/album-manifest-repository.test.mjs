import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
    runValidationCli,
    validateAlbumRepository,
} from "../../scripts/validate-album-repository.mjs";

const validationScript = fileURLToPath(new URL("../../scripts/validate-album-repository.mjs", import.meta.url));
const projectRoot = path.resolve(path.dirname(validationScript), "..");

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

function manifest(overrides = {}) {
    return {
        schemaVersion: 2,
        title: "Album",
        order: 10,
        cover: {
            photo: { kind: "local", filename: "cover.jpg" },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        blocks: [{ type: "Row", photos: ["content.jpg"] }],
        photos: [
            { filename: "content.jpg", tags: [] },
            { filename: "cover.jpg", tags: [] },
        ],
        ...overrides,
    };
}

function createRepository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-manifest-repository-"));
    write(root, "src/albums/yama/source.json", JSON.stringify(manifest({ title: "Source" })));
    write(root, "src/albums/yama/consumer.json", JSON.stringify(manifest({
        title: "Consumer",
        order: 20,
        cover: {
            photo: { kind: "external", assetKey: "yama/source/content.jpg" },
            zoom: 1.2,
            offset: { x: 40, y: 60 },
        },
        blocks: [{ type: "Row", photos: ["own.jpg"] }],
        photos: [{ filename: "own.jpg", tags: [] }],
    })));
    return root;
}

function diagnosticLocations(diagnostics) {
    return diagnostics.map(({ code, albumSlug, sourcePath, manifestPath, fieldPath }) => ({
        code, albumSlug, sourcePath, manifestPath, fieldPath,
    }));
}

test("production Album and Tag rendering read manifests through the catalog", () => {
    const sourceRoot = path.join(projectRoot, "src");
    const albumPage = fs.readFileSync(path.join(sourceRoot, "pages/[folder]/[album].astro"), "utf8");
    const albumBlocks = fs.readFileSync(path.join(sourceRoot, "components/AlbumBlocks.astro"), "utf8");
    const photoComponent = fs.readFileSync(path.join(sourceRoot, "components/Photo.astro"), "utf8");
    const photoFallback = fs.readFileSync(path.join(sourceRoot, "scripts/dev-tool/photo-fallback.ts"), "utf8");
    const tagPage = fs.readFileSync(path.join(sourceRoot, "pages/yama/tags/[tag].astro"), "utf8");

    assert.doesNotMatch(albumPage, /astro:content|albumEntry/);
    for (const field of ["title", "info", "gap"]) assert.match(albumPage, new RegExp(`albumRecord\\.${field}`));
    assert.match(albumPage, /<AlbumBlocks album=\{albumRecord\} \/>/);
    assert.doesNotMatch(photoComponent, /album-tags|import\.meta\.glob|Astro\.url\.pathname/);
    assert.match(albumBlocks, /caption: photo\.caption/);
    assert.match(photoComponent, /photo-caption--photo/);
    assert.match(photoComponent, /<RichText text=\{caption\}/);
    assert.match(tagPage, /caption=\{photo\.caption\}/);
    assert.doesNotMatch(photoComponent, /\bonerror=/);
    assert.match(photoComponent, /data-dev-fallback-url/);
    assert.match(
        photoFallback,
        /addEventListener\("error", useFallback, \{[\s\S]*once: true,[\s\S]*signal: controller\.signal,[\s\S]*\}\);/,
    );
    assert.match(photoFallback, /const controller = new AbortController\(\)/);
    assert.match(photoFallback, /controller\.abort\(\)/);
    assert.match(tagPage, /getTaggedPhotos\(decodedTag\)/);
    assert.match(tagPage, /sourceAlbumSlug/);
    assert.doesNotMatch(tagPage, /getAllPhotosWithTags|utils\/tags/);
    assert.equal(fs.existsSync(path.join(sourceRoot, "utils/tags.ts")), false);
});

test("production repository holds only valid Album manifests", () => {
    const result = validateAlbumRepository(projectRoot);
    assert.ok(result.albumCount > 0);
    assert.equal(result.validCount, result.albumCount);
    assert.deepEqual(result.diagnostics, []);
    const externalCover = JSON.parse(fs.readFileSync(
        path.join(projectRoot, "src/albums/yama/2025-omoteginza-d3.json"),
        "utf8",
    ));
    assert.deepEqual(externalCover.cover.photo, {
        kind: "external",
        assetKey: "yama/2025-omoteginza-d2/KCS06809.jpg",
    });
    const catalogPath = path.join(projectRoot, "src/lib/albums/catalog.ts");
    const catalogSource = fs.readFileSync(catalogPath, "utf8");
    assert.match(catalogSource, /import\.meta\.glob\(\s*["']\/src\/albums\/\*\*\/\*\.json["']/);
    assert.doesNotMatch(catalogSource, /astro:content|getCollection/);
    for (const api of ["getAlbumCatalog", "getAlbumSummaries", "getAlbumBySlug", "getTaggedPhotos"]) {
        assert.match(catalogSource, new RegExp(`export\\s+(?:async\\s+)?function\\s+${api}\\b`));
    }
});

test("production readers use the manifest catalog instead of frontmatter or order files", () => {
    for (const relativePath of [
        "src/pages/index.astro",
        "src/pages/[folder]/index.astro",
        "src/components/SiteNavigation.astro",
        "src/pages/rss.xml.ts",
    ]) {
        const source = fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
        assert.doesNotMatch(source, /_order\.json|\.data\.(?:title|info|publishedAt|coverKey|coverZoom|coverOffset|order|gap)\b/);
        assert.match(source, /lib\/albums\/catalog/);
    }
    assert.match(
        fs.readFileSync(path.join(projectRoot, "src/pages/index.astro"), "utf8"),
        /Home page requires at least one Album in the catalog/,
    );
});

test("repository contains no retired Album storage", () => {
    assert.deepEqual(filesBelow(projectRoot, "src/album-tags", (entry) => entry.endsWith(".json")), []);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/content")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/content.config.ts")), false);
});

test("Album build configuration validates manifests and carries no MDX pipeline", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const astroConfig = fs.readFileSync(path.join(projectRoot, "astro.config.mjs"), "utf8");
    assert.doesNotMatch(astroConfig, /@astrojs\/mdx|mdx\(\)/);
    assert.equal(packageJson.dependencies["@astrojs/mdx"], undefined);
    assert.equal(packageJson.scripts.prebuild, "node --import tsx scripts/validate-album-repository.mjs && node scripts/prepare-contour-assets.mjs prepare");
    assert.equal(packageJson.scripts["albums:validate"], "node --import tsx scripts/validate-album-repository.mjs");
    assert.match(packageJson.devDependencies.tsx, /^\^/);
});

test("validator accepts valid manifests", () => {
    assert.deepEqual(validateAlbumRepository(createRepository()), {
        albumCount: 2,
        validCount: 2,
        diagnostics: [],
    });
});

test("validator accumulates independent manifest failures", () => {
    const root = createRepository();
    const consumerManifest = path.join(root, "src/albums/yama/consumer.json");
    const brokenManifest = path.join(root, "src/albums/yama/broken.json");
    const consumer = JSON.parse(fs.readFileSync(consumerManifest, "utf8"));
    consumer.blocks.push({ type: "PhotoCarousel", photos: ["missing.jpg"] });
    fs.writeFileSync(consumerManifest, JSON.stringify(consumer));
    fs.writeFileSync(brokenManifest, "{");

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, { albumCount: 3, validCount: 1 });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "invalid-album-manifest",
            albumSlug: "yama/broken",
            sourcePath: brokenManifest,
            manifestPath: brokenManifest,
            fieldPath: "manifest",
        },
        {
            code: "block-photo-missing-from-manifest",
            albumSlug: "yama/consumer",
            sourcePath: consumerManifest,
            manifestPath: consumerManifest,
            fieldPath: "blocks",
        },
    ]);
});

test("validator deterministically attributes both retired storage forms", () => {
    const root = createRepository();
    const tagsPath = path.join(root, "src/album-tags/yama/source.json");
    const mdxPath = path.join(root, "src/content/albums/yama/source.mdx");
    write(root, "src/album-tags/yama/source.json", "{}");
    write(root, "src/content/albums/yama/source.mdx", "---\n---\n");
    const result = validateAlbumRepository(root);
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "retired-album-tag-sidecar",
            albumSlug: "yama/source",
            sourcePath: tagsPath,
            manifestPath: path.join(root, "src/albums/yama/source.json"),
            fieldPath: "tags",
        },
        {
            code: "retired-album-mdx",
            albumSlug: "yama/source",
            sourcePath: mdxPath,
            manifestPath: path.join(root, "src/albums/yama/source.json"),
            fieldPath: "blocks",
        },
    ]);
    assert.deepEqual(validateAlbumRepository(root), result);
});

test("validator runs catalog diagnostics alongside retired-storage diagnostics", () => {
    const root = createRepository();
    const tagsPath = path.join(root, "src/album-tags/yama/consumer.json");
    const sourceManifest = path.join(root, "src/albums/yama/source.json");
    const consumerManifest = path.join(root, "src/albums/yama/consumer.json");
    write(root, "src/album-tags/yama/consumer.json", "{}");
    const consumer = JSON.parse(fs.readFileSync(consumerManifest, "utf8"));
    consumer.order = 10;
    fs.writeFileSync(consumerManifest, JSON.stringify(consumer));
    assert.deepEqual(diagnosticLocations(validateAlbumRepository(root).diagnostics), [
        {
            code: "retired-album-tag-sidecar",
            albumSlug: "yama/consumer",
            sourcePath: tagsPath,
            manifestPath: consumerManifest,
            fieldPath: "tags",
        },
        {
            code: "duplicate-album-order",
            albumSlug: "yama/source",
            sourcePath: sourceManifest,
            manifestPath: sourceManifest,
            fieldPath: "order",
        },
    ]);
});

test("repository validator rejects a missing or empty manifest root through the CLI", () => {
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-roots-missing-"));
    assert.deepEqual(validateAlbumRepository(missingRoot).diagnostics.map(({ code }) => code), [
        "missing-album-manifest-root",
    ]);
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-roots-empty-"));
    fs.mkdirSync(path.join(emptyRoot, "src/albums"), { recursive: true });
    const errors = [];
    assert.equal(runValidationCli({ projectRoot: emptyRoot, stdout: () => {}, stderr: (message) => errors.push(message) }), 1);
    assert.match(errors.join("\n"), /empty-album-repository/);
});

test("repository validator rejects source symlinks without following them", () => {
    for (const item of [
        { relativePath: "src/albums/yama/linked.json", kind: "file" },
        { relativePath: "src/albums/linked", kind: "directory" },
    ]) {
        const root = createRepository();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "album-source-outside-"));
        const target = item.kind === "directory" ? outside : path.join(outside, "outside.json");
        if (item.kind === "file") fs.writeFileSync(target, "outside");
        const linkPath = path.join(root, item.relativePath);
        fs.mkdirSync(path.dirname(linkPath), { recursive: true });
        fs.symlinkSync(target, linkPath, item.kind === "directory" ? "dir" : "file");
        const result = validateAlbumRepository(root);
        const unsafe = result.diagnostics.filter(({ code }) => code === "unsafe-album-source-entry");
        assert.equal(unsafe.length, 1);
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

test("repository validator rejects invalid derived slugs", () => {
    const root = createRepository();
    write(root, "src/albums/yama/nested/album.json", "{}");
    write(root, "src/albums/yama/Bad.json", "{}");
    const diagnostics = validateAlbumRepository(root).diagnostics;
    assert.equal(diagnostics.filter(({ code }) => code === "invalid-album-slug").length, 2);
    assert.equal(diagnostics.some(({ code }) => code === "invalid-album-manifest"), false);
});

test("repository validator rejects symlinks in optional retired tag storage", () => {
    const rootSymlinkProject = createRepository();
    const rootOutside = fs.mkdtempSync(path.join(os.tmpdir(), "retired-tags-root-outside-"));
    fs.writeFileSync(path.join(rootOutside, "outside.json"), "{}");
    fs.symlinkSync(rootOutside, path.join(rootSymlinkProject, "src/album-tags"), "dir");
    assert.deepEqual(validateAlbumRepository(rootSymlinkProject).diagnostics.map(({ code }) => code), [
        "unsafe-retired-storage",
    ]);

    const root = createRepository();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "retired-tags-outside-"));
    const outsideFile = path.join(outside, "outside.json");
    fs.writeFileSync(outsideFile, "{}");
    fs.mkdirSync(path.join(root, "src/album-tags/yama"), { recursive: true });
    fs.symlinkSync(outsideFile, path.join(root, "src/album-tags/yama/file.json"), "file");
    fs.symlinkSync(outside, path.join(root, "src/album-tags/linked"), "dir");
    const result = validateAlbumRepository(root);
    assert.equal(result.diagnostics.filter(({ code }) => code === "unsafe-retired-storage").length, 2);
    assert.equal(result.diagnostics.some(({ sourcePath }) => sourcePath.startsWith(outside)), false);
});

test("retired Album frontmatter writers and compatibility route stay absent", () => {
    const pageStructure = fs.readFileSync(path.join(projectRoot, "src/lib/page-structure.ts"), "utf8");
    const albumImport = fs.readFileSync(path.join(projectRoot, "src/lib/album-import.ts"), "utf8");
    const routes = fs.readFileSync(path.join(projectRoot, "src/integrations/dev-api-routes.mjs"), "utf8");
    assert.doesNotMatch(pageStructure, /createPageContent|frontmatter/);
    assert.doesNotMatch(albumImport, /createAlbumMdx|coverKey:/);
    assert.doesNotMatch(routes, /save-page-structure/);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/dev-api/save-page-structure.ts")), false);
});

test("temporary Album migration implementation and commands stay retired", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    assert.equal(fs.existsSync(path.join(projectRoot, "scripts/migrate-albums.mjs")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/lib/albums/legacy-source.js")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/lib/albums/legacy-source.test.mjs")), false);
    assert.equal(packageJson.scripts["albums:migrate:check"], undefined);
    assert.equal(packageJson.scripts["albums:migrate:write"], undefined);
    assert.equal(packageJson.scripts["albums:migrate:cleanup"], undefined);
});
