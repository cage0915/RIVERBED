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
        schemaVersion: 1,
        title: "Album",
        order: 10,
        cover: {
            photo: { kind: "local", filename: "cover.jpg" },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        photos: [
            { filename: "content.jpg", tags: [] },
            { filename: "cover.jpg", tags: [] },
        ],
        ...overrides,
    };
}

function createCutoverRepository() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "album-manifest-repository-"));
    write(root, "src/content/albums/yama/source.mdx", `---\n---\n\n<Photo itemKey="content.jpg" />\n`);
    write(root, "src/album-manifests/yama/source.json", JSON.stringify(manifest({ title: "Source" })));
    write(root, "src/content/albums/yama/consumer.mdx", `---\n---\n\n<Photo itemKey="own.jpg" />\n`);
    write(root, "src/album-manifests/yama/consumer.json", JSON.stringify(manifest({
        title: "Consumer",
        order: 20,
        cover: {
            photo: { kind: "external", assetKey: "yama/source/content.jpg" },
            zoom: 1.2,
            offset: { x: 40, y: 60 },
        },
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
    const photoComponent = fs.readFileSync(path.join(sourceRoot, "components/Photo.astro"), "utf8");
    const albumPhotoComponent = fs.readFileSync(path.join(sourceRoot, "components/AlbumPhoto.astro"), "utf8");
    const tagPage = fs.readFileSync(path.join(sourceRoot, "pages/yama/tags/[tag].astro"), "utf8");

    assert.doesNotMatch(albumPage, /albumEntry\.data\.(?:title|info|gap)/);
    for (const field of ["title", "info", "gap"]) assert.match(albumPage, new RegExp(`albumRecord\\.${field}`));
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
    assert.equal(fs.existsSync(path.join(sourceRoot, "utils/tags.ts")), false);
});

test("production repository pairs 67 minimal MDX sources with valid manifests", () => {
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
    const catalogPath = path.join(projectRoot, "src/lib/albums/catalog.ts");
    const catalogSource = fs.readFileSync(catalogPath, "utf8");
    assert.match(catalogSource, /import\.meta\.glob\(\s*["']\/src\/album-manifests\/\*\*\/\*\.json["']/);
    for (const api of ["getAlbumCatalog", "getAlbumSummaries", "getAlbumBySlug", "getTaggedPhotos"]) {
        assert.match(catalogSource, new RegExp(`export\\s+(?:async\\s+)?function\\s+${api}\\b`));
    }
});

test("production readers use the manifest catalog instead of frontmatter or order files", () => {
    for (const relativePath of [
        "src/pages/index.astro",
        "src/pages/[folder]/index.astro",
        "src/layouts/Layout.astro",
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

test("repository contains no retired storage or mutable Album frontmatter", () => {
    assert.deepEqual([
        ...filesBelow(projectRoot, "src/album-tags", (entry) => entry.endsWith(".json")),
        ...filesBelow(projectRoot, "src/content/albums", (entry) => path.basename(entry) === "_order.json"),
    ], []);
    const forbidden = /^(?:title|coverKey|coverZoom|coverOffset|publishedAt|info|order|gap):/m;
    for (const mdxPath of filesBelow(projectRoot, "src/content/albums", (entry) => entry.endsWith(".mdx"))) {
        const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(mdxPath, "utf8"))?.[1] ?? "";
        assert.doesNotMatch(frontmatter, forbidden, path.relative(projectRoot, mdxPath));
    }
});

test("post-cutover configuration validates manifests before contour preparation", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    const contentConfig = fs.readFileSync(path.join(projectRoot, "src/content/config.ts"), "utf8");
    assert.match(contentConfig, /schema:\s*z\.object\(\{\}\)\.strict\(\)/);
    assert.doesNotMatch(contentConfig, /title|coverKey|publishedAt|coverZoom|coverOffset|\border\b|\bgap\b/);
    assert.equal(packageJson.scripts.prebuild, "node scripts/validate-album-repository.mjs && node scripts/prepare-contour-assets.mjs prepare");
    assert.equal(packageJson.scripts["albums:validate"], "node scripts/validate-album-repository.mjs");
});

test("post-cutover validator accepts paired minimal sources", () => {
    assert.deepEqual(validateAlbumRepository(createCutoverRepository()), {
        albumCount: 2,
        validCount: 2,
        diagnostics: [],
    });
});

test("post-cutover validator accumulates missing, orphan, and independent source failures", () => {
    const root = createCutoverRepository();
    const consumerMdx = path.join(root, "src/content/albums/yama/consumer.mdx");
    const consumerManifest = path.join(root, "src/album-manifests/yama/consumer.json");
    const orphanManifest = path.join(root, "src/album-manifests/yama/orphan.json");
    fs.unlinkSync(consumerManifest);
    fs.writeFileSync(consumerMdx, `---\n---\n\n<Photo itemKey={dynamic} />\n`);
    fs.writeFileSync(orphanManifest, "{}");

    const result = validateAlbumRepository(root);
    assert.deepEqual({ albumCount: result.albumCount, validCount: result.validCount }, { albumCount: 2, validCount: 1 });
    assert.deepEqual(diagnosticLocations(result.diagnostics), [
        {
            code: "missing-album-manifest",
            albumSlug: "yama/consumer",
            sourcePath: consumerManifest,
            manifestPath: consumerManifest,
            fieldPath: "manifest",
        },
        {
            code: "mdx-photo-syntax",
            albumSlug: "yama/consumer",
            sourcePath: consumerMdx,
            manifestPath: consumerManifest,
            fieldPath: "Photo@1",
        },
        {
            code: "invalid-album-manifest",
            albumSlug: "yama/orphan",
            sourcePath: orphanManifest,
            manifestPath: orphanManifest,
            fieldPath: "manifest",
        },
        {
            code: "orphan-album-manifest",
            albumSlug: "yama/orphan",
            sourcePath: orphanManifest,
            manifestPath: orphanManifest,
            fieldPath: "slug",
        },
    ]);
});

test("post-cutover validator attributes invalid MDX and manifests independently", () => {
    const invalidMdxRoot = createCutoverRepository();
    const invalidMdxPath = path.join(invalidMdxRoot, "src/content/albums/yama/consumer.mdx");
    const pairedManifestPath = path.join(invalidMdxRoot, "src/album-manifests/yama/consumer.json");
    fs.writeFileSync(invalidMdxPath, `---\ntitle: "retired"\n---\n\n<Photo itemKey="own.jpg" />\n`);
    assert.deepEqual(diagnosticLocations(validateAlbumRepository(invalidMdxRoot).diagnostics), [{
        code: "invalid-album-mdx",
        albumSlug: "yama/consumer",
        sourcePath: invalidMdxPath,
        manifestPath: pairedManifestPath,
        fieldPath: "frontmatter",
    }]);

    const invalidManifestRoot = createCutoverRepository();
    const validMdxPath = path.join(invalidManifestRoot, "src/content/albums/yama/consumer.mdx");
    const invalidManifestPath = path.join(invalidManifestRoot, "src/album-manifests/yama/consumer.json");
    fs.writeFileSync(invalidManifestPath, "{");
    assert.deepEqual(diagnosticLocations(validateAlbumRepository(invalidManifestRoot).diagnostics), [{
        code: "invalid-album-manifest",
        albumSlug: "yama/consumer",
        sourcePath: invalidManifestPath,
        manifestPath: invalidManifestPath,
        fieldPath: "manifest",
    }]);
    assert.match(fs.readFileSync(validMdxPath, "utf8"), /^---\n---\n/);
});

test("post-cutover validator deterministically attributes both retired storage forms", () => {
    const root = createCutoverRepository();
    const tagsPath = path.join(root, "src/album-tags/yama/source.json");
    const orderPath = path.join(root, "src/content/albums/yama/_order.json");
    write(root, "src/album-tags/yama/source.json", "{}");
    write(root, "src/content/albums/yama/_order.json", "[]");
    const result = validateAlbumRepository(root);
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

test("post-cutover validator runs catalog diagnostics alongside retired-storage diagnostics", () => {
    const root = createCutoverRepository();
    const tagsPath = path.join(root, "src/album-tags/yama/consumer.json");
    const sourceManifest = path.join(root, "src/album-manifests/yama/source.json");
    const consumerManifest = path.join(root, "src/album-manifests/yama/consumer.json");
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

test("manifest-global checks remain safe when paired MDX is invalid", () => {
    const root = createCutoverRepository();
    const sourceMdx = path.join(root, "src/content/albums/yama/source.mdx");
    const consumerManifest = path.join(root, "src/album-manifests/yama/consumer.json");
    fs.writeFileSync(sourceMdx, "missing frontmatter");
    const consumer = JSON.parse(fs.readFileSync(consumerManifest, "utf8"));
    consumer.order = 10;
    fs.writeFileSync(consumerManifest, JSON.stringify(consumer));
    const diagnostics = validateAlbumRepository(root).diagnostics;
    assert.equal(diagnostics.some(({ code }) => code === "duplicate-album-order"), true);
    assert.equal(diagnostics.some(({ code }) => code === "external-cover-source-missing"), false);
});

test("repository validator rejects missing and empty required roots through the CLI", () => {
    const missingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-roots-missing-"));
    assert.deepEqual(validateAlbumRepository(missingRoot).diagnostics.map(({ code }) => code), [
        "missing-album-manifest-root",
        "missing-album-mdx-root",
    ]);
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "album-roots-empty-"));
    fs.mkdirSync(path.join(emptyRoot, "src/content/albums"), { recursive: true });
    fs.mkdirSync(path.join(emptyRoot, "src/album-manifests"), { recursive: true });
    const errors = [];
    assert.equal(runValidationCli({ projectRoot: emptyRoot, stdout: () => {}, stderr: (message) => errors.push(message) }), 1);
    assert.match(errors.join("\n"), /empty-album-repository/);
});

test("repository validator rejects source symlinks without following them", () => {
    for (const item of [
        { relativePath: "src/content/albums/yama/linked.mdx", kind: "file" },
        { relativePath: "src/album-manifests/yama/linked.json", kind: "file" },
        { relativePath: "src/content/albums/linked", kind: "directory" },
    ]) {
        const root = createCutoverRepository();
        const outside = fs.mkdtempSync(path.join(os.tmpdir(), "album-source-outside-"));
        const target = item.kind === "directory" ? outside : path.join(outside, "outside.mdx");
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

test("repository validator rejects invalid derived slugs without pairing noise", () => {
    const root = createCutoverRepository();
    write(root, "src/content/albums/yama/nested/album.mdx", "---\n---\n");
    write(root, "src/album-manifests/yama/nested/album.json", "{}");
    write(root, "src/content/albums/yama/Bad.mdx", "---\n---\n");
    write(root, "src/album-manifests/yama/Bad.json", "{}");
    const diagnostics = validateAlbumRepository(root).diagnostics;
    assert.equal(diagnostics.filter(({ code }) => code === "invalid-album-slug").length, 4);
    assert.equal(diagnostics.some(({ code }) => ["missing-album-manifest", "orphan-album-manifest"].includes(code)), false);
});

test("repository validator rejects symlinks in optional retired tag storage", () => {
    const rootSymlinkProject = createCutoverRepository();
    const rootOutside = fs.mkdtempSync(path.join(os.tmpdir(), "retired-tags-root-outside-"));
    fs.writeFileSync(path.join(rootOutside, "outside.json"), "{}");
    fs.symlinkSync(rootOutside, path.join(rootSymlinkProject, "src/album-tags"), "dir");
    assert.deepEqual(validateAlbumRepository(rootSymlinkProject).diagnostics.map(({ code }) => code), [
        "unsafe-retired-storage",
    ]);

    const root = createCutoverRepository();
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
    const albumImport = fs.readFileSync(path.join(projectRoot, "src/lib/album-import.js"), "utf8");
    const routes = fs.readFileSync(path.join(projectRoot, "src/integrations/dev-api-routes.mjs"), "utf8");
    assert.doesNotMatch(pageStructure, /createPageContent|frontmatter/);
    assert.doesNotMatch(albumImport, /createAlbumMdx|coverKey:/);
    assert.doesNotMatch(routes, /save-page-structure/);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/dev-api/save-page-structure.ts")), false);
});

test("temporary Album migration implementation and commands stay retired", () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
    assert.equal(fs.existsSync(path.join(projectRoot, "scripts/migrate-album-manifests.mjs")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/lib/albums/legacy-source.js")), false);
    assert.equal(fs.existsSync(path.join(projectRoot, "src/lib/albums/legacy-source.test.mjs")), false);
    assert.equal(packageJson.scripts["albums:migrate:check"], undefined);
    assert.equal(packageJson.scripts["albums:migrate:write"], undefined);
    assert.equal(packageJson.scripts["albums:migrate:cleanup"], undefined);
});
