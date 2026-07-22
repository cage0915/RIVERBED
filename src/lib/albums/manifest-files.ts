import {
    lstat,
    mkdir,
    readdir,
    readFile,
    realpath,
    rename,
    unlink,
    writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import {
    normalizeAssetKey,
    validateAlbumSlug,
    validateLocalPhotoFilename,
} from "./keys.ts";
import { parseAlbumManifest } from "./manifest-schema.ts";
import type { AlbumManifest, PhotoTag } from "./types.ts";

type ManifestLocation = {
    slug: string;
    manifestRoot: string;
    folder: string;
    target: string;
};

export type ManifestFileOperations = {
    rename: typeof rename;
    unlink: typeof unlink;
};

const defaultFileOperations: ManifestFileOperations = { rename, unlink };

export class AlbumManifestMutationError extends Error {
    readonly code: "album-not-found" | "cover-untracked";

    constructor(
        code: "album-not-found" | "cover-untracked",
        message: string,
    ) {
        super(message);
        this.name = "AlbumManifestMutationError";
        this.code = code;
    }
}

const mutationQueues = new Map<string, Promise<void>>();

function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function assertExistingPathIsSafe(
    containmentRoot: string,
    candidate: string,
    label: string,
): Promise<boolean> {
    let stats;
    try {
        stats = await lstat(candidate);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
        throw error;
    }
    if (stats.isSymbolicLink()) {
        throw new Error(`Album manifest storage must not contain symlinks: ${label}`);
    }
    const resolved = await realpath(candidate);
    if (!isContained(containmentRoot, resolved)) {
        throw new Error(`Album manifest storage escapes the project root: ${label}`);
    }
    return true;
}

async function resolveManifestLocation(
    projectRoot: string,
    albumSlug: string,
): Promise<ManifestLocation> {
    const slug = validateAlbumSlug(albumSlug);
    const projectRootReal = await realpath(path.resolve(projectRoot));
    const sourceRoot = path.join(projectRootReal, "src");
    const manifestRoot = path.join(sourceRoot, "album-manifests");
    const [folderName] = slug.split("/");
    const folder = path.join(manifestRoot, folderName);
    const target = path.join(manifestRoot, `${slug}.json`);

    await assertExistingPathIsSafe(projectRootReal, sourceRoot, "src");
    await assertExistingPathIsSafe(projectRootReal, manifestRoot, "src/album-manifests");
    await assertExistingPathIsSafe(projectRootReal, folder, `${folderName}`);
    await assertExistingPathIsSafe(projectRootReal, target, `${slug}.json`);
    return { slug, manifestRoot, folder, target };
}

export async function readAlbumManifestFile(
    projectRoot: string,
    albumSlug: string,
): Promise<AlbumManifest> {
    const location = await resolveManifestLocation(projectRoot, albumSlug);
    let input: unknown;
    try {
        input = JSON.parse(await readFile(location.target, "utf8"));
    } catch (cause) {
        throw new Error(
            `Unable to read Album manifest ${location.slug}`,
            { cause },
        );
    }
    return parseAlbumManifest(input, location.slug);
}

export async function readAllAlbumManifestFiles(
    projectRoot: string,
): Promise<Record<string, AlbumManifest>> {
    const projectRootReal = await realpath(path.resolve(projectRoot));
    const root = path.join(projectRootReal, "src", "album-manifests");
    await assertExistingPathIsSafe(projectRootReal, path.join(projectRootReal, "src"), "src");
    await assertExistingPathIsSafe(projectRootReal, root, "src/album-manifests");
    const rootEntries = await readdir(root, { withFileTypes: true });
    const rootSymlink = rootEntries.find((entry) => entry.isSymbolicLink());
    if (rootSymlink) {
        throw new Error(`Album manifest storage must not contain symlinks: ${rootSymlink.name}`);
    }
    const folders = rootEntries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    const entries: [string, AlbumManifest][] = [];
    for (const folder of folders) {
        const folderPath = path.join(root, folder);
        await assertExistingPathIsSafe(projectRootReal, folderPath, folder);
        const folderEntries = await readdir(folderPath, { withFileTypes: true });
        const folderSymlink = folderEntries.find((entry) => entry.isSymbolicLink());
        if (folderSymlink) {
            throw new Error(
                `Album manifest storage must not contain symlinks: ${folder}/${folderSymlink.name}`,
            );
        }
        const filenames = folderEntries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
            .map((entry) => entry.name)
            .sort();
        for (const manifestFilename of filenames) {
            const slug = `${folder}/${manifestFilename.slice(0, -".json".length)}`;
            entries.push([slug, await readAlbumManifestFile(projectRoot, slug)]);
        }
    }
    return Object.fromEntries(entries);
}

async function writeAlbumManifestFileUnlocked(
    projectRoot: string,
    albumSlug: string,
    input: unknown,
): Promise<AlbumManifest> {
    let location = await resolveManifestLocation(projectRoot, albumSlug);
    const manifest = parseAlbumManifest(input, location.slug);
    await mkdir(location.folder, { recursive: true });
    location = await resolveManifestLocation(projectRoot, location.slug);
    const temporary = path.join(
        location.folder,
        `.${path.basename(location.target)}.${process.pid}.${randomUUID()}.tmp`,
    );
    const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

    try {
        await writeFile(temporary, serialized, { encoding: "utf8", flag: "wx" });
        await assertExistingPathIsSafe(location.manifestRoot, temporary, "temporary manifest");
        parseAlbumManifest(
            JSON.parse(await readFile(temporary, "utf8")),
            location.slug,
        );
        // The checks bound accidental/configuration escapes; a local TOCTOU race
        // still requires OS-level directory handles, which this editor does not use.
        location = await resolveManifestLocation(projectRoot, location.slug);
        await rename(temporary, location.target);
    } catch (error) {
        await unlink(temporary).catch(() => undefined);
        throw error;
    }
    return manifest;
}

function manifestLockKeys(locations: ManifestLocation[]): string[] {
    return locations.flatMap(({ target, folder }) => [target, `${folder}\0folder`]);
}

export async function writeAlbumManifestFile(
    projectRoot: string,
    albumSlug: string,
    input: unknown,
): Promise<AlbumManifest> {
    const location = await resolveManifestLocation(projectRoot, albumSlug);
    return enqueueManifestMutations(manifestLockKeys([location]), () =>
        writeAlbumManifestFileUnlocked(projectRoot, location.slug, input)
    );
}

async function enqueueManifestMutations<T>(
    keys: string[],
    operation: () => Promise<T>,
): Promise<T> {
    const uniqueKeys = [...new Set(keys)].sort();
    const previous = Promise.all(
        uniqueKeys.map((key) => (mutationQueues.get(key) ?? Promise.resolve()).catch(() => undefined)),
    );
    const result = previous.then(operation);
    const tail = result.then(() => undefined, () => undefined);
    for (const key of uniqueKeys) mutationQueues.set(key, tail);
    try {
        return await result;
    } finally {
        for (const key of uniqueKeys) {
            if (mutationQueues.get(key) === tail) mutationQueues.delete(key);
        }
    }
}

async function replaceAlbumManifestFiles(
    projectRoot: string,
    manifests: Record<string, AlbumManifest>,
    originals: Record<string, AlbumManifest>,
    operations: ManifestFileOperations = defaultFileOperations,
): Promise<void> {
    const entries = await Promise.all(Object.entries(manifests).map(async ([slug, input]) => {
        const location = await resolveManifestLocation(projectRoot, slug);
        const manifest = parseAlbumManifest(input, location.slug);
        return { location, manifest };
    }));
    const staged: Array<{
        location: ManifestLocation;
        manifest: AlbumManifest;
        temporary: string;
        backup: string;
        backupCreated: boolean;
        replaced: boolean;
    }> = [];

    try {
        for (const entry of entries) {
            const token = `${process.pid}.${randomUUID()}`;
            const basename = path.basename(entry.location.target);
            const temporary = path.join(entry.location.folder, `.${basename}.${token}.tmp`);
            const backup = path.join(entry.location.folder, `.${basename}.${token}.bak`);
            const stagedEntry = {
                ...entry,
                temporary,
                backup,
                backupCreated: false,
                replaced: false,
            };
            staged.push(stagedEntry);
            await writeFile(temporary, `${JSON.stringify(entry.manifest, null, 2)}\n`, {
                encoding: "utf8",
                flag: "wx",
            });
            await assertExistingPathIsSafe(entry.location.manifestRoot, temporary, "temporary manifest");
            parseAlbumManifest(JSON.parse(await readFile(temporary, "utf8")), entry.location.slug);
        }

        for (const entry of staged) {
            const currentLocation = await resolveManifestLocation(projectRoot, entry.location.slug);
            if (currentLocation.target !== entry.location.target || currentLocation.folder !== entry.location.folder) {
                throw new Error(`Album manifest path changed before replacement: ${entry.location.slug}`);
            }
            await operations.rename(entry.location.target, entry.backup);
            entry.backupCreated = true;
            await operations.rename(entry.temporary, entry.location.target);
            entry.replaced = true;
        }
        const cleanupErrors: unknown[] = [];
        for (const entry of staged) {
            try {
                await operations.unlink(entry.backup);
            } catch (cleanupError) {
                cleanupErrors.push(cleanupError);
            }
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError(
                cleanupErrors,
                "Album manifest replacement committed but backup cleanup is incomplete",
            );
        }
    } catch (error) {
        if (error instanceof AggregateError &&
            error.message.includes("replacement committed")) throw error;
        const rollbackErrors: unknown[] = [];
        for (const entry of [...staged].reverse()) {
            if (entry.replaced) {
                try {
                    await operations.unlink(entry.location.target);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            if (entry.backupCreated) {
                try {
                    await operations.rename(entry.backup, entry.location.target);
                } catch (rollbackError) {
                    rollbackErrors.push(rollbackError);
                }
            }
            try {
                await operations.unlink(entry.temporary);
            } catch (cleanupError) {
                if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") {
                    rollbackErrors.push(cleanupError);
                }
            }
        }
        for (const entry of staged) {
            try {
                const restored = parseAlbumManifest(
                    JSON.parse(await readFile(entry.location.target, "utf8")),
                    entry.location.slug,
                );
                if (JSON.stringify(restored) !== JSON.stringify(originals[entry.location.slug])) {
                    rollbackErrors.push(new Error(`Rollback verification failed: ${entry.location.slug}`));
                }
            } catch (verificationError) {
                rollbackErrors.push(verificationError);
            }
        }
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                "Album manifest batch replacement failed; rollback incomplete and backups were preserved",
            );
        }
        throw error;
    }
}

export async function mutateAlbumManifestFile(
    projectRoot: string,
    albumSlug: string,
    mutate: (manifest: AlbumManifest) => AlbumManifest | Promise<AlbumManifest>,
): Promise<AlbumManifest> {
    const location = await resolveManifestLocation(projectRoot, albumSlug);
    return enqueueManifestMutations(manifestLockKeys([location]), async () => {
        const manifest = await readAlbumManifestFile(projectRoot, location.slug);
        const updated = await mutate(manifest);
        return writeAlbumManifestFileUnlocked(projectRoot, location.slug, updated);
    });
}

export async function mutateAlbumManifestFiles(
    projectRoot: string,
    albumSlugs: string[],
    mutate: (
        manifests: Record<string, AlbumManifest>,
    ) => Record<string, AlbumManifest> | Promise<Record<string, AlbumManifest>>,
    operations: ManifestFileOperations = defaultFileOperations,
): Promise<Record<string, AlbumManifest>> {
    const slugs = [...new Set(albumSlugs.map(validateAlbumSlug))].sort();
    if (slugs.length !== albumSlugs.length) throw new Error("Duplicate Album slug in manifest mutation");
    const locations = await Promise.all(slugs.map((slug) => resolveManifestLocation(projectRoot, slug)));
    return enqueueManifestMutations(manifestLockKeys(locations), async () => {
        const current = Object.fromEntries(await Promise.all(slugs.map(async (slug) => [
            slug,
            await readAlbumManifestFile(projectRoot, slug),
        ])));
        const proposed = await mutate(current);
        const proposedSlugs = Object.keys(proposed).sort();
        if (proposedSlugs.length !== slugs.length || proposedSlugs.some((slug, index) => slug !== slugs[index])) {
            throw new Error("Multi-Album manifest mutation must return exactly the requested Albums");
        }
        const parsed = Object.fromEntries(slugs.map((slug) => [
            slug,
            parseAlbumManifest(proposed[slug], slug),
        ]));
        await replaceAlbumManifestFiles(projectRoot, parsed, current, operations);
        return parsed;
    });
}

export async function updateAlbumCover(
    projectRoot: string,
    albumSlug: string,
    input: {
        assetKey: string;
        zoom: number;
        offset: { x: number; y: number };
    },
): Promise<AlbumManifest> {
    const consumerSlug = validateAlbumSlug(albumSlug);
    const assetKey = normalizeAssetKey(input.assetKey);
    const parts = assetKey.split("/");
    const sourceSlug = validateAlbumSlug(`${parts[0]}/${parts[1]}`);
    const filename = validateLocalPhotoFilename(parts[2]);
    const locations = await Promise.all(
        [...new Set([consumerSlug, sourceSlug])].map((slug) => resolveManifestLocation(projectRoot, slug)),
    );
    return enqueueManifestMutations(manifestLockKeys(locations), async () => {
        let consumerManifest: AlbumManifest;
        try {
            consumerManifest = await readAlbumManifestFile(projectRoot, consumerSlug);
        } catch (error) {
            if ((error as Error & { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT") {
                throw new AlbumManifestMutationError(
                    "album-not-found",
                    `Album manifest not found: ${consumerSlug}`,
                );
            }
            throw error;
        }
        let sourceManifest: AlbumManifest;
        try {
            sourceManifest = sourceSlug === consumerSlug
                ? consumerManifest
                : await readAlbumManifestFile(projectRoot, sourceSlug);
        } catch (error) {
            if ((error as Error & { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT") {
                throw new AlbumManifestMutationError(
                    "cover-untracked",
                    `Cover asset is not tracked by an Album manifest: ${assetKey}`,
                );
            }
            throw error;
        }
        if (!sourceManifest.photos.some((photo) => photo.filename === filename)) {
            throw new AlbumManifestMutationError(
                "cover-untracked",
                `Cover asset is not tracked by an Album manifest: ${assetKey}`,
            );
        }
        const photo = sourceSlug === consumerSlug
            ? { kind: "local" as const, filename }
            : { kind: "external" as const, assetKey };
        return writeAlbumManifestFileUnlocked(projectRoot, consumerSlug, {
            ...consumerManifest,
            cover: { photo, zoom: input.zoom, offset: { ...input.offset } },
        });
    });
}

export async function reorderFolderAlbums(
    projectRoot: string,
    folder: string,
    requestedOrder: string[],
): Promise<Array<{ slug: string; manifest: AlbumManifest }>> {
    if (!/^[a-z0-9-]+$/.test(folder)) throw new Error("Invalid Album folder");
    if (!Array.isArray(requestedOrder)) throw new Error("Album order must be an array");
    const order = requestedOrder.map(validateAlbumSlug);
    if (new Set(order).size !== order.length) throw new Error("Album order contains duplicate entries");
    if (order.some((slug) => !slug.startsWith(`${folder}/`))) {
        throw new Error("Album order contains an entry from another folder");
    }
    if (order.length === 0) throw new Error("Album order must contain the complete folder Album list");
    const firstLocation = await resolveManifestLocation(projectRoot, order[0]);
    return enqueueManifestMutations([`${firstLocation.folder}\0folder`], async () => {
        const allManifests = await readAllAlbumManifestFiles(projectRoot);
        const existing = Object.keys(allManifests).filter((slug) => slug.startsWith(`${folder}/`)).sort();
        if (existing.length === 0) throw new Error(`Album folder not found: ${folder}`);
        const requestedSlugs = new Set<string>(order);
        if (existing.length !== order.length || existing.some((slug) => !requestedSlugs.has(slug))) {
            throw new Error("Album order must contain the complete folder Album list");
        }
        const originals = Object.fromEntries(order.map((slug) => [slug, allManifests[slug]]));
        const updated = Object.fromEntries(order.map((slug, index) => [
            slug,
            parseAlbumManifest({ ...originals[slug], order: (index + 1) * 10 }, slug),
        ]));
        await replaceAlbumManifestFiles(projectRoot, updated, originals);
        return order.map((slug) => ({ slug, manifest: updated[slug] }));
    });
}

function replacePhoto(
    manifest: AlbumManifest,
    filename: string,
    replace: (photo: AlbumManifest["photos"][number]) => AlbumManifest["photos"][number],
): AlbumManifest {
    const localFilename = validateLocalPhotoFilename(filename);
    const photoIndex = manifest.photos.findIndex((photo) => photo.filename === localFilename);
    if (photoIndex < 0) {
        throw new Error(`Photo not found in Album manifest: ${localFilename}`);
    }
    return {
        ...manifest,
        photos: manifest.photos.map((photo, index) =>
            index === photoIndex ? replace(photo) : photo
        ),
    };
}

export async function updatePhotoTags(
    projectRoot: string,
    albumSlug: string,
    filename: string,
    tags: PhotoTag[],
): Promise<AlbumManifest> {
    return mutateAlbumManifestFile(projectRoot, albumSlug, (manifest) =>
        replacePhoto(manifest, filename, (photo) => ({ ...photo, tags }))
    );
}

export async function replaceAlbumPhotoTags(
    projectRoot: string,
    albumSlug: string,
    tagsByFilename: Record<string, PhotoTag[]>,
): Promise<AlbumManifest> {
    return mutateAlbumManifestFile(projectRoot, albumSlug, (manifest) => {
        const knownFilenames = new Set(manifest.photos.map((photo) => photo.filename));
        for (const filename of Object.keys(tagsByFilename)) {
            const localFilename = validateLocalPhotoFilename(filename);
            if (!knownFilenames.has(localFilename)) {
                throw new Error(`Photo not found in Album manifest: ${localFilename}`);
            }
        }
        return {
            ...manifest,
            photos: manifest.photos.map((photo) => ({
                ...photo,
                tags: tagsByFilename[photo.filename] ?? [],
            })),
        };
    });
}

export async function updatePhotoCaption(
    projectRoot: string,
    albumSlug: string,
    filename: string,
    caption: string | undefined,
): Promise<AlbumManifest> {
    const normalizedCaption = caption?.trim() ? caption : undefined;
    return mutateAlbumManifestFile(projectRoot, albumSlug, (manifest) =>
        replacePhoto(manifest, filename, (photo) => ({
            ...photo,
            caption: normalizedCaption,
        }))
    );
}
