import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createAlbumCatalog } from "../src/lib/albums/catalog-core.ts";
import { validateAlbumSlug } from "../src/lib/albums/keys.ts";
import { parseAlbumManifest } from "../src/lib/albums/manifest-schema.ts";
import { extractMdxPhotos, MdxPhotoError } from "../src/lib/albums/mdx-photos.ts";

function scanRequiredRoot({
    root,
    kind,
    manifestsRoot,
    diagnostics,
    required = true,
    unsafeCode = "unsafe-album-source-entry",
}) {
    let rootStat;
    try {
        rootStat = fs.lstatSync(root);
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        if (required) {
            diagnostics.push(issue(
                kind === "mdx" ? "missing-album-mdx-root" : "missing-album-manifest-root",
                "*",
                root,
                manifestsRoot,
                "root",
                `Required Album ${kind === "mdx" ? "MDX" : "manifest"} root is missing`,
            ));
        }
        return [];
    }
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        diagnostics.push(issue(
            unsafeCode,
            "*",
            root,
            manifestsRoot,
            "root",
            rootStat.isSymbolicLink()
                ? "Album source root must not be a symbolic link"
                : "Album source root must be a directory",
        ));
        return [];
    }

    const files = [];
    const directories = [root];
    while (directories.length > 0) {
        const directory = directories.pop();
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => compareText(left.name, right.name))) {
            const filename = path.join(directory, entry.name);
            const stat = fs.lstatSync(filename);
            if (stat.isSymbolicLink()) {
                diagnostics.push(issue(
                    unsafeCode,
                    "*",
                    filename,
                    kind === "manifest" ? filename : manifestsRoot,
                    "source",
                    "Album source entries must not be symbolic links",
                ));
            } else if (stat.isDirectory()) {
                directories.push(filename);
            } else if (stat.isFile()) {
                files.push(filename);
            } else {
                diagnostics.push(issue(
                    unsafeCode,
                    "*",
                    filename,
                    kind === "manifest" ? filename : manifestsRoot,
                    "source",
                    "Album source entries must be regular files or directories",
                ));
            }
        }
    }
    return files.sort(compareText);
}

function relative(projectRoot, filename) {
    return path.relative(projectRoot, filename).split(path.sep).join("/");
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

function slugFrom(root, filename, extension) {
    return path.relative(root, filename).slice(0, -extension.length).split(path.sep).join("/");
}

function issue(code, albumSlug, sourcePath, manifestPath, fieldPath, message) {
    return { code, albumSlug, sourcePath, manifestPath, fieldPath, message };
}

function splitMinimalMdx(source) {
    const match = /^---\r?\n(?:(.*?)\r?\n)?---(?:\r?\n|$)/s.exec(source);
    if (!match) throw new Error("Album MDX must start with empty frontmatter");
    if ((match[1] ?? "").trim()) throw new Error("Album MDX frontmatter must be empty after manifest cutover");
    return source.slice(match[0].length);
}

function validateManifestGlobals(records) {
    const diagnostics = [];
    const orderOwner = new Map();
    const trackedAssetKeys = new Set(records.flatMap(({ slug, manifest }) =>
        manifest.photos.map(({ filename }) => `${slug}/${filename}`)));

    for (const record of [...records].sort((left, right) => compareText(left.slug, right.slug))) {
        const [folder] = record.slug.split("/");
        const orderKey = `${folder}\0${record.manifest.order}`;
        const previousOrderOwner = orderOwner.get(orderKey);
        if (previousOrderOwner !== undefined) {
            diagnostics.push(issue(
                "duplicate-album-order",
                record.slug,
                record.manifestPath,
                record.manifestPath,
                "order",
                `Album order ${record.manifest.order} duplicates ${previousOrderOwner.slug} within folder ${folder}`,
            ));
        } else {
            orderOwner.set(orderKey, record);
        }

        const cover = record.manifest.cover.photo;
        if (cover.kind !== "external") continue;
        if (cover.assetKey.startsWith(`${record.slug}/`)) {
            diagnostics.push(issue(
                "external-cover-source-same-album",
                record.slug,
                record.manifestPath,
                record.manifestPath,
                "cover.photo.assetKey",
                `External cover asset ${JSON.stringify(cover.assetKey)} belongs to the consumer Album; use a local cover reference`,
            ));
        } else if (!trackedAssetKeys.has(cover.assetKey)) {
            diagnostics.push(issue(
                "external-cover-source-missing",
                record.slug,
                record.manifestPath,
                record.manifestPath,
                "cover.photo.assetKey",
                `External cover asset ${JSON.stringify(cover.assetKey)} is not tracked by any Album manifest inventory`,
            ));
        }
    }
    return diagnostics;
}

export function validateAlbumRepository(projectRoot = process.cwd()) {
    const albumsRoot = path.join(projectRoot, "src/content/albums");
    const manifestsRoot = path.join(projectRoot, "src/album-manifests");
    const tagsRoot = path.join(projectRoot, "src/album-tags");
    const diagnostics = [];
    const albumSourceFiles = scanRequiredRoot({
        root: albumsRoot,
        kind: "mdx",
        manifestsRoot,
        diagnostics,
    });
    const manifestSourceFiles = scanRequiredRoot({
        root: manifestsRoot,
        kind: "manifest",
        manifestsRoot,
        diagnostics,
    });
    const retiredTagFiles = scanRequiredRoot({
        root: tagsRoot,
        kind: "retired",
        manifestsRoot,
        diagnostics,
        required: false,
        unsafeCode: "unsafe-retired-storage",
    });
    const rawMdxFiles = albumSourceFiles.filter((filename) => filename.endsWith(".mdx"));
    const rawManifestFiles = manifestSourceFiles.filter((filename) => filename.endsWith(".json"));
    if (fs.existsSync(albumsRoot) && fs.existsSync(manifestsRoot) && rawMdxFiles.length === 0) {
        diagnostics.push(issue(
            "empty-album-repository",
            "*",
            albumsRoot,
            manifestsRoot,
            "albums",
            "Album repository must contain at least one MDX Album",
        ));
    }
    const mdxFiles = [];
    const manifestFiles = [];
    for (const [kind, root, files, accepted] of [
        ["mdx", albumsRoot, rawMdxFiles, mdxFiles],
        ["manifest", manifestsRoot, rawManifestFiles, manifestFiles],
    ]) {
        for (const filename of files) {
            const extension = kind === "mdx" ? ".mdx" : ".json";
            const slug = slugFrom(root, filename, extension);
            try {
                validateAlbumSlug(slug);
                accepted.push(filename);
            } catch (error) {
                diagnostics.push(issue(
                    "invalid-album-slug",
                    slug,
                    filename,
                    kind === "manifest" ? filename : path.join(manifestsRoot, `${slug}.json`),
                    "slug",
                    error instanceof Error ? error.message : String(error),
                ));
            }
        }
    }
    const records = [];
    const manifestRecords = [];
    const mdxBySlug = new Map(mdxFiles.map((filename) => [
        slugFrom(albumsRoot, filename, ".mdx"),
        filename,
    ]));
    const mdxSlugs = new Set(mdxBySlug.keys());
    const manifestBySlug = new Map(manifestFiles.map((filename) => [
        slugFrom(manifestsRoot, filename, ".json"),
        filename,
    ]));

    for (const filename of retiredTagFiles.filter((entry) => entry.endsWith(".json"))) {
        const slug = slugFrom(tagsRoot, filename, ".json");
        diagnostics.push(issue(
            "retired-album-tag-sidecar",
            slug,
            filename,
            path.join(manifestsRoot, `${slug}.json`),
            "tags",
            "Legacy Album tag sidecars are retired; store tags in the Album manifest",
        ));
    }
    for (const filename of albumSourceFiles.filter((entry) => path.basename(entry) === "_order.json")) {
        const folder = path.basename(path.dirname(filename));
        diagnostics.push(issue(
            "retired-album-order-file",
            `${folder}/*`,
            filename,
            path.join(manifestsRoot, folder),
            "order",
            "Legacy Album order files are retired; store order in each Album manifest",
        ));
    }

    const sourceSlugs = [...new Set([...mdxBySlug.keys(), ...manifestBySlug.keys()])].sort(compareText);
    for (const slug of sourceSlugs) {
        const mdxPath = mdxBySlug.get(slug);
        const existingManifestPath = manifestBySlug.get(slug);
        const manifestPath = existingManifestPath ?? path.join(manifestsRoot, `${slug}.json`);
        if (mdxPath === undefined) {
            diagnostics.push(issue(
                "orphan-album-manifest",
                slug,
                manifestPath,
                manifestPath,
                "slug",
                "Album manifest has no matching MDX source",
            ));
        }
        if (existingManifestPath === undefined) {
            diagnostics.push(issue(
                "missing-album-manifest",
                slug,
                manifestPath,
                manifestPath,
                "manifest",
                "Manifest is missing",
            ));
        }
        let mdxBody;
        if (mdxPath !== undefined) {
            try {
                mdxBody = splitMinimalMdx(fs.readFileSync(mdxPath, "utf8"));
                extractMdxPhotos(mdxBody);
            } catch (error) {
                diagnostics.push(issue(
                    error instanceof MdxPhotoError ? "mdx-photo-syntax" : "invalid-album-mdx",
                    slug,
                    mdxPath,
                    manifestPath,
                    error instanceof MdxPhotoError ? `Photo@${error.offset}` : "frontmatter",
                    error instanceof Error ? error.message : String(error),
                ));
                mdxBody = undefined;
            }
        }
        let manifest;
        if (existingManifestPath !== undefined) {
            try {
                manifest = parseAlbumManifest(JSON.parse(fs.readFileSync(existingManifestPath, "utf8")), slug);
                if (mdxPath !== undefined) {
                    manifestRecords.push({ slug, manifestPath: existingManifestPath, manifest });
                }
            } catch (error) {
                diagnostics.push(issue(
                    "invalid-album-manifest",
                    slug,
                    existingManifestPath,
                    existingManifestPath,
                    "manifest",
                    error instanceof Error ? error.message : String(error),
                ));
            }
        }
        if (mdxPath !== undefined && mdxBody !== undefined && manifest !== undefined) {
            records.push({ slug, mdxPath, mdxBody, manifestPath, manifest });
        }
    }

    diagnostics.push(...createAlbumCatalog(records).diagnostics.filter(({ code }) =>
        !["duplicate-album-order", "external-cover-source-same-album", "external-cover-source-missing"].includes(code)));
    diagnostics.push(...validateManifestGlobals(manifestRecords));
    diagnostics.sort((left, right) =>
        compareText(left.albumSlug, right.albumSlug) ||
        compareText(left.sourcePath, right.sourcePath) ||
        compareText(left.manifestPath, right.manifestPath) ||
        compareText(left.fieldPath ?? "", right.fieldPath ?? "") ||
        compareText(left.code, right.code) ||
        compareText(left.message, right.message));
    const invalidSlugs = new Set(diagnostics
        .map(({ albumSlug }) => albumSlug)
        .filter((slug) => mdxSlugs.has(slug)));
    return {
        albumCount: mdxFiles.length,
        validCount: records.filter(({ slug }) => !invalidSlugs.has(slug)).length,
        diagnostics,
    };
}

export function runValidationCli({
    projectRoot = process.cwd(),
    stdout = console.log,
    stderr = console.error,
} = {}) {
    const result = validateAlbumRepository(projectRoot);
    for (const diagnostic of result.diagnostics) {
        stderr(
            `[${diagnostic.code}] ${diagnostic.albumSlug} ` +
            `${relative(projectRoot, diagnostic.sourcePath)} ${diagnostic.fieldPath}: ${diagnostic.message}`,
        );
    }
    stdout(`${result.validCount}/${result.albumCount} Album manifests valid, ${result.diagnostics.length} diagnostics`);
    return result.diagnostics.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = runValidationCli();
}
