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

import { validateAlbumSlug, validateLocalPhotoFilename } from "./keys.ts";
import { parseAlbumManifest } from "./manifest-schema.ts";
import type { AlbumManifest, PhotoTag } from "./types.ts";

type ManifestLocation = {
    slug: string;
    manifestRoot: string;
    folder: string;
    target: string;
};

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

export async function writeAlbumManifestFile(
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

async function enqueueManifestMutation<T>(
    key: string,
    operation: () => Promise<T>,
): Promise<T> {
    const previous = mutationQueues.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    mutationQueues.set(key, tail);
    try {
        return await result;
    } finally {
        if (mutationQueues.get(key) === tail) mutationQueues.delete(key);
    }
}

export async function mutateAlbumManifestFile(
    projectRoot: string,
    albumSlug: string,
    mutate: (manifest: AlbumManifest) => AlbumManifest | Promise<AlbumManifest>,
): Promise<AlbumManifest> {
    const location = await resolveManifestLocation(projectRoot, albumSlug);
    return enqueueManifestMutation(location.target, async () => {
        const manifest = await readAlbumManifestFile(projectRoot, location.slug);
        const updated = await mutate(manifest);
        return writeAlbumManifestFile(projectRoot, location.slug, updated);
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
