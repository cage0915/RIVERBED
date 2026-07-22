import fs from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

import { createAlbumCatalog } from "./catalog-core.ts";
import { normalizeAssetKey, validateLocalPhotoFilename } from "./keys.ts";
import { parseAlbumManifest } from "./manifest-schema.ts";
import { extractMdxPhotos, findMdxTagEnd } from "./mdx-photos.ts";

const SUPPORTED_FIELDS = new Set([
    "title",
    "info",
    "publishedAt",
    "order",
    "coverKey",
    "coverZoom",
    "coverOffset",
    "gap",
]);

class LegacyMigrationError extends Error {
    constructor(code, message, fieldPath, sourceKind = "mdx") {
        super(message);
        this.name = "LegacyMigrationError";
        this.code = code;
        this.fieldPath = fieldPath;
        this.sourceKind = sourceKind;
    }
}

function parseQuoted(value, field) {
    const quote = value[0];
    if ((quote !== '"' && quote !== "'") || value.at(-1) !== quote) {
        throw new Error(`Unsupported frontmatter value for ${field}`);
    }
    const inner = value.slice(1, -1);
    if (quote === '"') {
        try {
            return JSON.parse(value);
        } catch {
            throw new Error(`Unsupported frontmatter value for ${field}`);
        }
    }
    return inner.replace(/\\'/g, "'").replace(/\\\\/g, "\\");
}

function parseString(value, field, { allowBare = false } = {}) {
    if (value.startsWith('"') || value.startsWith("'")) return parseQuoted(value, field);
    if (allowBare && value && !/[\[\]{}#,]/.test(value)) return value;
    throw new Error(`Unsupported frontmatter value for ${field}`);
}

function parseNumber(value, field) {
    if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
        throw new Error(`Unsupported frontmatter value for ${field}`);
    }
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`Unsupported frontmatter value for ${field}`);
    return number;
}

function parseOffset(value) {
    const match = /^\{\s*x:\s*(-?(?:\d+\.?\d*|\.\d+))\s*,\s*y:\s*(-?(?:\d+\.?\d*|\.\d+))\s*\}$/.exec(value);
    if (!match) throw new Error("Unsupported frontmatter value for coverOffset");
    return { x: Number(match[1]), y: Number(match[2]) };
}

function legacyTagError(code, message, fieldPath) {
    return new LegacyMigrationError(code, message, fieldPath, "tags");
}

function validateLegacyTagEntries(filename, value) {
    const photoPath = `photos[${JSON.stringify(filename)}].tags`;
    if (!Array.isArray(value)) {
        throw legacyTagError("legacy-tag-invalid", "Legacy photo tags must be an array", photoPath);
    }
    return value.map((tag, index) => {
        const tagPath = `${photoPath}[${index}]`;
        if (typeof tag !== "object" || tag === null || Array.isArray(tag)) {
            throw legacyTagError("legacy-tag-invalid", "Legacy tag must be an object", tagPath);
        }
        const unknown = Object.keys(tag).find((key) => !["name", "x", "y"].includes(key));
        if (unknown !== undefined) {
            throw legacyTagError(
                "legacy-tag-invalid",
                `Legacy tag has unknown field: ${unknown}`,
                `${tagPath}.${unknown}`,
            );
        }
        if (typeof tag.name !== "string" || !tag.name.trim()) {
            throw legacyTagError(
                "legacy-tag-invalid",
                "Legacy tag name must be a non-empty string",
                `${tagPath}.name`,
            );
        }
        for (const coordinate of ["x", "y"]) {
            if (typeof tag[coordinate] !== "number" || !Number.isFinite(tag[coordinate])) {
                throw legacyTagError(
                    "legacy-tag-coordinate-invalid",
                    `Legacy tag ${coordinate} must be a finite number`,
                    `${tagPath}.${coordinate}`,
                );
            }
            if (tag[coordinate] < 0 || tag[coordinate] > 100) {
                throw legacyTagError(
                    "legacy-tag-coordinate-invalid",
                    `Legacy tag ${coordinate} must be between 0 and 100`,
                    `${tagPath}.${coordinate}`,
                );
            }
        }
        return { name: tag.name, x: tag.x, y: tag.y };
    });
}

export function parseLegacyFrontmatter(mdxSource) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(mdxSource);
    if (!match) throw new Error("Legacy frontmatter not found");
    const values = {};
    for (const rawLine of match[1].split(/\r?\n/)) {
        if (!rawLine.trim()) continue;
        const fieldMatch = /^([A-Za-z][A-Za-z0-9]*):\s*(.*?)\s*$/.exec(rawLine);
        if (!fieldMatch || !SUPPORTED_FIELDS.has(fieldMatch[1])) {
            throw new Error(`Unsupported legacy frontmatter line: ${rawLine}`);
        }
        const [, field, rawValue] = fieldMatch;
        if (Object.hasOwn(values, field)) throw new Error(`Duplicate frontmatter field: ${field}`);
        if (["title", "info", "coverKey", "gap"].includes(field)) {
            values[field] = parseString(rawValue, field);
        } else if (field === "publishedAt") {
            values[field] = parseString(rawValue, field, { allowBare: true });
        } else if (["order", "coverZoom"].includes(field)) {
            values[field] = parseNumber(rawValue, field);
        } else if (field === "coverOffset") {
            values[field] = parseOffset(rawValue);
        }
    }
    return { values, body: mdxSource.slice(match[0].length), bodyOffset: match[0].length };
}

function normalizeTags(albumSlug, tags, inventory) {
    if (typeof tags !== "object" || tags === null || Array.isArray(tags)) {
        throw legacyTagError("legacy-tag-invalid", "Legacy tag sidecar must be an object", "tags");
    }
    const normalized = new Map();
    for (const [legacyKey, value] of Object.entries(tags ?? {})) {
        let filename;
        if (legacyKey.includes("/")) {
            const assetKey = normalizeAssetKey(legacyKey);
            const prefix = `${albumSlug}/`;
            if (!assetKey.startsWith(prefix)) {
                throw new LegacyMigrationError(
                    "legacy-tag-stale",
                    `Stale tag key belongs to another Album: ${legacyKey}`,
                    `tags[${JSON.stringify(legacyKey)}]`,
                    "tags",
                );
            }
            filename = assetKey.slice(prefix.length);
        } else {
            filename = validateLocalPhotoFilename(legacyKey);
        }
        if (!inventory.has(filename)) {
            throw new LegacyMigrationError(
                "legacy-tag-stale",
                `Stale tag key: ${legacyKey}`,
                `tags[${JSON.stringify(legacyKey)}]`,
                "tags",
            );
        }
        if (normalized.has(filename)) {
            throw new LegacyMigrationError(
                "legacy-tag-duplicate",
                `Duplicate normalized tag key: ${filename}`,
                `tags[${JSON.stringify(legacyKey)}]`,
                "tags",
            );
        }
        normalized.set(filename, validateLegacyTagEntries(filename, value));
    }
    return normalized;
}

function captionAt(source, offset) {
    const end = findMdxTagEnd(source, offset + "<Photo".length);
    if (end === -1) return undefined;
    const tag = source.slice(offset, end + 1);
    const match = /\bcaption\s*=\s*/.exec(tag);
    if (!match) return undefined;
    const valueOffset = match.index + match[0].length;
    const quote = tag[valueOffset];
    if (quote !== '"' && quote !== "'") {
        throw new Error("Photo caption must be a supported static quoted string");
    }
    let escaped = false;
    for (let index = valueOffset + 1; index < tag.length; index += 1) {
        if (escaped) {
            escaped = false;
        } else if (tag[index] === "\\") {
            escaped = true;
        } else if (tag[index] === quote) {
            return tag.slice(valueOffset + 1, index);
        }
    }
    throw new Error("Photo caption must be a supported static quoted string");
}

export function convertLegacyAlbum(input) {
    const { values, body, bodyOffset } = parseLegacyFrontmatter(input.mdxSource);
    const references = extractMdxPhotos(body);
    const filenames = references.map(({ filename }) => filename);
    const inventory = new Set(filenames);

    if (typeof values.coverKey !== "string") throw new Error("Missing legacy frontmatter coverKey");
    let coverPhoto;
    if (values.coverKey.includes("/")) {
        const assetKey = normalizeAssetKey(values.coverKey);
        if (assetKey.startsWith(`${input.albumSlug}/`)) {
            throw new Error("Same-Album full coverKey must be stored as a local filename");
        }
        if (!input.trackedAlbumPhotos.has(assetKey)) {
            throw new Error(`External cover is not tracked by another Album: ${assetKey}`);
        }
        coverPhoto = { kind: "external", assetKey };
    } else {
        const filename = validateLocalPhotoFilename(values.coverKey);
        const assetKey = `${input.albumSlug}/${filename}`;
        if (!input.trackedAlbumPhotos.has(assetKey)) {
            throw new Error(`Local cover is not tracked by its Album: ${filename}`);
        }
        coverPhoto = { kind: "local", filename };
        inventory.add(filename);
    }

    const tags = normalizeTags(input.albumSlug, input.tags, inventory);
    const captionByFilename = new Map(references.map((reference) => [
        reference.filename,
        captionAt(input.mdxSource, bodyOffset + reference.offset),
    ]));
    const photos = [...filenames, ...[...inventory].filter((filename) => !filenames.includes(filename))]
        .map((filename) => ({
            filename,
            ...(captionByFilename.get(filename) === undefined
                ? {}
                : { caption: captionByFilename.get(filename) }),
            tags: tags.get(filename) ?? [],
        }));

    if (typeof values.title !== "string") throw new Error("Missing legacy frontmatter title");
    const coverZoom = values.coverZoom ?? 1;
    const coverOffset = values.coverOffset ?? { x: 50, y: 50 };
    return {
        schemaVersion: 1,
        title: values.title,
        ...(values.info === undefined ? {} : { info: values.info }),
        ...(values.publishedAt === undefined ? {} : { publishedAt: values.publishedAt }),
        order: input.order,
        ...(values.gap === undefined ? {} : { gap: values.gap }),
        cover: {
            photo: coverPhoto,
            zoom: coverZoom,
            offset: coverOffset,
        },
        photos,
    };
}

function diagnostic({ code, albumSlug, sourcePath, manifestPath, fieldPath, error, message }) {
    return {
        code,
        message: message ?? (error instanceof Error ? error.message : String(error)),
        albumSlug,
        sourcePath,
        manifestPath,
        fieldPath,
    };
}

function readJson(filename) {
    return JSON.parse(fs.readFileSync(filename, "utf8"));
}

function persistable(value) {
    return JSON.parse(JSON.stringify(value));
}

function albumFiles(albumsRoot) {
    if (!fs.existsSync(albumsRoot)) return [];
    return fs.readdirSync(albumsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((folder) => fs.readdirSync(path.join(albumsRoot, folder.name), { withFileTypes: true })
            .filter((entry) => entry.isFile() && entry.name.endsWith(".mdx"))
            .sort((left, right) => left.name.localeCompare(right.name))
            .map((entry) => ({
                folder: folder.name,
                albumId: entry.name.slice(0, -".mdx".length),
                mdxPath: path.join(albumsRoot, folder.name, entry.name),
            })));
}

function jsonFiles(root) {
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))
        .flatMap((entry) => {
            const target = path.join(root, entry.name);
            if (entry.isDirectory()) return jsonFiles(target);
            return entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
        });
}

function slugFromJson(root, filename) {
    return path.relative(root, filename).slice(0, -".json".length).split(path.sep).join("/");
}

function manifestPathFor(manifestsRoot, albumSlug) {
    return path.join(manifestsRoot, ...albumSlug.split("/")) + ".json";
}

function diagnosticFromError({ albumSlug, mdxPath, tagsPath, manifestPath, error }) {
    if (error instanceof LegacyMigrationError) {
        return diagnostic({
            code: error.code,
            albumSlug,
            sourcePath: error.sourceKind === "tags" ? tagsPath : mdxPath,
            manifestPath,
            fieldPath: error.fieldPath,
            error,
        });
    }
    return diagnostic({
        code: "legacy-album-invalid",
        albumSlug,
        sourcePath: mdxPath,
        manifestPath,
        fieldPath: "album",
        error,
    });
}

function loadOrders(albumsRoot, manifestsRoot, files, diagnostics) {
    const byFolder = new Map();
    for (const { folder } of files) {
        if (byFolder.has(folder)) continue;
        const orderPath = path.join(albumsRoot, folder, "_order.json");
        try {
            const order = readJson(orderPath);
            if (!Array.isArray(order) || order.some((item) => typeof item !== "string")) {
                throw new Error("Album order must be an array of Album IDs");
            }
            const expected = files.filter((file) => file.folder === folder).map(({ albumId }) => albumId);
            if (new Set(order).size !== order.length ||
                order.length !== expected.length ||
                expected.some((albumId) => !order.includes(albumId))) {
                throw new Error(`Album order must list every ${folder} Album exactly once`);
            }
            byFolder.set(folder, new Map(order.map((albumId, index) => [albumId, (index + 1) * 10])));
        } catch (error) {
            diagnostics.push(diagnostic({
                code: "legacy-order-invalid",
                albumSlug: `${folder}/*`,
                sourcePath: orderPath,
                manifestPath: path.join(manifestsRoot, folder),
                fieldPath: "order",
                error,
            }));
        }
    }
    return byFolder;
}

export function createLegacyMigrationPlan(projectRoot = process.cwd()) {
    const albumsRoot = path.join(projectRoot, "src/content/albums");
    const manifestsRoot = path.join(projectRoot, "src/album-manifests");
    const tagsRoot = path.join(projectRoot, "src/album-tags");
    const files = albumFiles(albumsRoot);
    const diagnostics = [];
    const mdxSlugs = new Set(files.map(({ folder, albumId }) => `${folder}/${albumId}`));
    for (const filename of jsonFiles(manifestsRoot)) {
        const albumSlug = slugFromJson(manifestsRoot, filename);
        if (mdxSlugs.has(albumSlug)) continue;
        diagnostics.push(diagnostic({
            code: "orphan-album-manifest",
            message: "Album manifest has no matching MDX source",
            albumSlug,
            sourcePath: filename,
            manifestPath: filename,
            fieldPath: "slug",
        }));
    }
    for (const filename of jsonFiles(tagsRoot)) {
        const albumSlug = slugFromJson(tagsRoot, filename);
        if (mdxSlugs.has(albumSlug)) continue;
        diagnostics.push(diagnostic({
            code: "orphan-legacy-tag",
            message: "Legacy tag sidecar has no matching MDX source",
            albumSlug,
            sourcePath: filename,
            manifestPath: manifestPathFor(manifestsRoot, albumSlug),
            fieldPath: "slug",
        }));
    }
    const orders = loadOrders(albumsRoot, manifestsRoot, files, diagnostics);
    const rawAlbums = [];
    const trackedAlbumPhotos = new Set();

    for (const file of files) {
        const albumSlug = `${file.folder}/${file.albumId}`;
        const manifestPath = manifestPathFor(manifestsRoot, albumSlug);
        try {
            const mdxSource = fs.readFileSync(file.mdxPath, "utf8");
            const { values, body } = parseLegacyFrontmatter(mdxSource);
            for (const { filename } of extractMdxPhotos(body)) {
                trackedAlbumPhotos.add(`${albumSlug}/${filename}`);
            }
            if (typeof values.coverKey === "string" && !values.coverKey.includes("/")) {
                trackedAlbumPhotos.add(`${albumSlug}/${validateLocalPhotoFilename(values.coverKey)}`);
            }
            rawAlbums.push({ ...file, albumSlug, mdxSource });
        } catch (error) {
            diagnostics.push(diagnostic({
                code: "legacy-mdx-invalid",
                albumSlug,
                sourcePath: file.mdxPath,
                manifestPath,
                fieldPath: "mdx",
                error,
            }));
        }
    }

    const candidates = [];
    for (const album of rawAlbums) {
        const order = orders.get(album.folder)?.get(album.albumId);
        if (order === undefined) continue;
        const tagsPath = path.join(tagsRoot, album.folder, `${album.albumId}.json`);
        const manifestPath = manifestPathFor(manifestsRoot, album.albumSlug);
        let tags;
        try {
            tags = fs.existsSync(tagsPath) ? readJson(tagsPath) : {};
        } catch (error) {
            diagnostics.push(diagnostic({
                code: "legacy-tag-invalid",
                albumSlug: album.albumSlug,
                sourcePath: tagsPath,
                manifestPath,
                fieldPath: "tags",
                error,
            }));
            continue;
        }
        try {
            const manifest = convertLegacyAlbum({
                albumSlug: album.albumSlug,
                mdxPath: album.mdxPath,
                mdxSource: album.mdxSource,
                order,
                tags,
                trackedAlbumPhotos,
            });
            try {
                parseAlbumManifest(manifest, album.albumSlug);
            } catch (error) {
                throw new LegacyMigrationError(
                    "candidate-manifest-invalid",
                    error instanceof Error ? error.message : String(error),
                    "manifest",
                );
            }
            candidates.push({
                slug: album.albumSlug,
                mdxPath: album.mdxPath,
                mdxBody: parseLegacyFrontmatter(album.mdxSource).body,
                manifestPath,
                manifest,
            });
        } catch (error) {
            diagnostics.push(diagnosticFromError({
                albumSlug: album.albumSlug,
                mdxPath: album.mdxPath,
                tagsPath,
                manifestPath,
                error,
            }));
        }
    }

    candidates.sort((left, right) =>
        left.slug.split("/")[0].localeCompare(right.slug.split("/")[0]) ||
        left.manifest.order - right.manifest.order ||
        left.slug.localeCompare(right.slug));
    diagnostics.sort((left, right) =>
        left.albumSlug.localeCompare(right.albumSlug) ||
        left.sourcePath.localeCompare(right.sourcePath) ||
        left.fieldPath.localeCompare(right.fieldPath) ||
        left.code.localeCompare(right.code));
    return { projectRoot, albumCount: files.length, candidates, diagnostics };
}

export function writeAlbumManifests(plan) {
    if (plan.diagnostics.length > 0) {
        throw new Error(`Refusing to write manifests with ${plan.diagnostics.length} diagnostic(s)`);
    }
    let unchanged = 0;
    for (const candidate of plan.candidates) {
        if (!fs.existsSync(candidate.manifestPath)) continue;
        let existing;
        try {
            existing = parseAlbumManifest(readJson(candidate.manifestPath), candidate.slug);
        } catch {
            throw new Error(`Refusing to overwrite non-equivalent manifest: ${candidate.manifestPath}`);
        }
        if (!isDeepStrictEqual(persistable(existing), persistable(candidate.manifest))) {
            throw new Error(`Refusing to overwrite non-equivalent manifest: ${candidate.manifestPath}`);
        }
        unchanged += 1;
    }
    for (const candidate of plan.candidates) {
        if (fs.existsSync(candidate.manifestPath)) continue;
        fs.mkdirSync(path.dirname(candidate.manifestPath), { recursive: true });
        fs.writeFileSync(candidate.manifestPath, `${JSON.stringify(candidate.manifest, null, 2)}\n`);
    }
    return { written: plan.candidates.length - unchanged, unchanged };
}

export function validateAlbumManifests(projectRoot = process.cwd()) {
    const plan = createLegacyMigrationPlan(projectRoot);
    const diagnostics = [...plan.diagnostics];
    const records = [];
    for (const candidate of plan.candidates) {
        if (!fs.existsSync(candidate.manifestPath)) {
            diagnostics.push(diagnostic({
                code: "missing-album-manifest",
                message: "Manifest is missing",
                albumSlug: candidate.slug,
                sourcePath: candidate.manifestPath,
                manifestPath: candidate.manifestPath,
                fieldPath: "manifest",
            }));
            continue;
        }
        try {
            const manifest = parseAlbumManifest(readJson(candidate.manifestPath), candidate.slug);
            if (!isDeepStrictEqual(persistable(manifest), persistable(candidate.manifest))) {
                diagnostics.push(diagnostic({
                    code: "manifest-not-equivalent",
                    message: "Manifest is not equivalent to its normalized legacy source",
                    albumSlug: candidate.slug,
                    sourcePath: candidate.manifestPath,
                    manifestPath: candidate.manifestPath,
                    fieldPath: "manifest",
                }));
                continue;
            }
            records.push({ ...candidate, manifest });
        } catch (error) {
            diagnostics.push(diagnostic({
                code: "invalid-album-manifest",
                albumSlug: candidate.slug,
                sourcePath: candidate.manifestPath,
                manifestPath: candidate.manifestPath,
                fieldPath: "manifest",
                error,
            }));
        }
    }
    if (diagnostics.length === 0) {
        diagnostics.push(...createAlbumCatalog(records).diagnostics.map((item) => ({
            ...item,
            manifestPath: records.find(({ slug }) => slug === item.albumSlug)?.manifestPath ?? item.sourcePath,
        })));
    }
    diagnostics.sort((left, right) =>
        left.albumSlug.localeCompare(right.albumSlug) ||
        left.sourcePath.localeCompare(right.sourcePath) ||
        (left.fieldPath ?? "").localeCompare(right.fieldPath ?? "") ||
        left.code.localeCompare(right.code));
    return { albumCount: plan.albumCount, equivalentCount: records.length, diagnostics };
}
