import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createAlbumCatalog } from "../src/lib/albums/catalog-core.ts";
import { validateAlbumSlug } from "../src/lib/albums/keys.ts";
import { parseAlbumManifest } from "../src/lib/albums/manifest-schema.ts";

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
                "missing-album-manifest-root",
                "*",
                root,
                manifestsRoot,
                "root",
                "Required Album manifest root is missing",
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

export function validateAlbumRepository(projectRoot = process.cwd()) {
    const manifestsRoot = path.join(projectRoot, "src/album-manifests");
    const retiredRoots = [
        {
            root: path.join(projectRoot, "src/album-tags"),
            code: "retired-album-tag-sidecar",
            fieldPath: "tags",
            message: "Legacy Album tag sidecars are retired; store tags in the Album manifest",
        },
        {
            root: path.join(projectRoot, "src/content/albums"),
            code: "retired-album-mdx",
            fieldPath: "blocks",
            message: "Album MDX is retired; store layout in the Album manifest blocks",
        },
    ];
    const diagnostics = [];
    const manifestSourceFiles = scanRequiredRoot({
        root: manifestsRoot,
        kind: "manifest",
        manifestsRoot,
        diagnostics,
    });
    for (const { root, code, fieldPath, message } of retiredRoots) {
        const retiredFiles = scanRequiredRoot({
            root,
            kind: "retired",
            manifestsRoot,
            diagnostics,
            required: false,
            unsafeCode: "unsafe-retired-storage",
        });
        for (const filename of retiredFiles) {
            const slug = slugFrom(root, filename, path.extname(filename));
            diagnostics.push(issue(code, slug, filename, path.join(manifestsRoot, `${slug}.json`), fieldPath, message));
        }
    }

    const rawManifestFiles = manifestSourceFiles.filter((filename) => filename.endsWith(".json"));
    if (fs.existsSync(manifestsRoot) && rawManifestFiles.length === 0) {
        diagnostics.push(issue(
            "empty-album-repository",
            "*",
            manifestsRoot,
            manifestsRoot,
            "albums",
            "Album repository must contain at least one Album manifest",
        ));
    }

    const records = [];
    const manifestSlugs = new Set();
    for (const filename of rawManifestFiles) {
        const slug = slugFrom(manifestsRoot, filename, ".json");
        try {
            validateAlbumSlug(slug);
        } catch (error) {
            diagnostics.push(issue(
                "invalid-album-slug",
                slug,
                filename,
                filename,
                "slug",
                error instanceof Error ? error.message : String(error),
            ));
            continue;
        }
        manifestSlugs.add(slug);
        try {
            const manifest = parseAlbumManifest(JSON.parse(fs.readFileSync(filename, "utf8")), slug);
            records.push({ slug, manifestPath: filename, manifest });
        } catch (error) {
            diagnostics.push(issue(
                "invalid-album-manifest",
                slug,
                filename,
                filename,
                "manifest",
                error instanceof Error ? error.message : String(error),
            ));
        }
    }

    diagnostics.push(...createAlbumCatalog(records).diagnostics);
    diagnostics.sort((left, right) =>
        compareText(left.albumSlug, right.albumSlug) ||
        compareText(left.sourcePath, right.sourcePath) ||
        compareText(left.manifestPath, right.manifestPath) ||
        compareText(left.fieldPath ?? "", right.fieldPath ?? "") ||
        compareText(left.code, right.code) ||
        compareText(left.message, right.message));
    const invalidSlugs = new Set(diagnostics
        .map(({ albumSlug }) => albumSlug)
        .filter((slug) => manifestSlugs.has(slug)));
    return {
        albumCount: manifestSlugs.size,
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
