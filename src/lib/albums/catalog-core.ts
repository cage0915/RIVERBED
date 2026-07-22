import { validateAlbumSlug } from "./keys.ts";
import { extractMdxPhotos } from "./mdx-photos.ts";
import type {
    AlbumManifest,
    AlbumSlug,
    NormalizedAlbum,
    ResolvedAlbumPhoto,
    TaggedPhoto,
} from "./types.ts";
import { validateAlbumInventory } from "./validation.ts";
import type { AlbumDiagnostic } from "./validation.ts";

export type AlbumSourceRecord = {
    slug: string;
    manifestPath: string;
    mdxPath: string;
    mdxBody: string;
    manifest: AlbumManifest;
};

export type AlbumCatalog = {
    getAlbum(slug: string): NormalizedAlbum | null;
    getAlbums(): NormalizedAlbum[];
    getAlbumsInFolder(folder: string): NormalizedAlbum[];
    getTaggedPhotos(tagName: string): TaggedPhoto[];
    getExternalCoverReferences(assetKey: string): AlbumSlug[];
    diagnostics: AlbumDiagnostic[];
};

type IndexedAlbum = {
    album: NormalizedAlbum;
    contentPhotos: TaggedPhoto[];
};

function compareAlbums(left: NormalizedAlbum, right: NormalizedAlbum): number {
    return left.order - right.order || compareText(left.slug, right.slug);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function compareSourceRecords(left: AlbumSourceRecord, right: AlbumSourceRecord): number {
    return compareText(left.slug, right.slug) ||
        compareText(left.manifestPath, right.manifestPath) ||
        compareText(left.mdxPath, right.mdxPath) ||
        compareText(left.mdxBody, right.mdxBody) ||
        compareText(JSON.stringify(left.manifest), JSON.stringify(right.manifest));
}

function compareDiagnostics(left: AlbumDiagnostic, right: AlbumDiagnostic): number {
    return compareText(left.albumSlug, right.albumSlug) ||
        compareText(left.sourcePath, right.sourcePath) ||
        compareText(left.manifestPath, right.manifestPath) ||
        compareText(left.fieldPath ?? "", right.fieldPath ?? "") ||
        compareText(left.code, right.code) ||
        compareText(left.message, right.message);
}

function cloneDiagnostic(diagnostic: AlbumDiagnostic): AlbumDiagnostic {
    return { ...diagnostic };
}

function cloneResolvedPhoto(photo: ResolvedAlbumPhoto): ResolvedAlbumPhoto {
    return {
        ...photo,
        tags: photo.tags.map((tag) => ({ ...tag })),
    };
}

function cloneTaggedPhoto(photo: TaggedPhoto): TaggedPhoto {
    return {
        ...cloneResolvedPhoto(photo),
        isContent: true,
    };
}

function cloneAlbum(album: NormalizedAlbum): NormalizedAlbum {
    return {
        ...album,
        cover: {
            ...album.cover,
            photo: { ...album.cover.photo },
            offset: { ...album.cover.offset },
        },
        photos: album.photos.map(cloneResolvedPhoto),
    };
}

function invalidSlugDiagnostic(record: AlbumSourceRecord, error: unknown): AlbumDiagnostic {
    return {
        code: "invalid-album-slug",
        message: error instanceof Error ? error.message : `Invalid album slug: ${record.slug}`,
        albumSlug: record.slug,
        sourcePath: record.manifestPath,
        manifestPath: record.manifestPath,
        fieldPath: "slug",
    };
}

export function createAlbumCatalog(records: AlbumSourceRecord[]): AlbumCatalog {
    const diagnostics: AlbumDiagnostic[] = [];
    const indexedBySlug = new Map<AlbumSlug, IndexedAlbum>();
    const sourceBySlug = new Map<AlbumSlug, AlbumSourceRecord>();
    const orderOwner = new Map<string, AlbumSourceRecord>();

    for (const record of [...records].sort(compareSourceRecords)) {
        let slug: AlbumSlug;
        try {
            slug = validateAlbumSlug(record.slug);
        } catch (error) {
            diagnostics.push(invalidSlugDiagnostic(record, error));
            continue;
        }

        const existing = sourceBySlug.get(slug);
        if (existing !== undefined) {
            diagnostics.push({
                code: "duplicate-album-slug",
                message: `Duplicate Album slug ${JSON.stringify(slug)}; first declared by ${existing.manifestPath}`,
                albumSlug: slug,
                sourcePath: record.manifestPath,
                manifestPath: record.manifestPath,
                fieldPath: "slug",
            });
            continue;
        }
        sourceBySlug.set(slug, record);

        diagnostics.push(...validateAlbumInventory({
            albumSlug: slug,
            manifestPath: record.manifestPath,
            manifest: record.manifest,
            mdxPath: record.mdxPath,
            mdxBody: record.mdxBody,
        }));

        const [folder, albumId] = slug.split("/") as [string, string];
        const orderKey = `${folder}\0${record.manifest.order}`;
        const previousOrderOwner = orderOwner.get(orderKey);
        if (previousOrderOwner !== undefined) {
            diagnostics.push({
                code: "duplicate-album-order",
                message: `Album order ${record.manifest.order} duplicates ${previousOrderOwner.slug} within folder ${folder}`,
                albumSlug: slug,
                sourcePath: record.manifestPath,
                manifestPath: record.manifestPath,
                fieldPath: "order",
            });
        } else {
            orderOwner.set(orderKey, record);
        }

        const contentFilenames: string[] = [];
        try {
            const seen = new Set<string>();
            for (const reference of extractMdxPhotos(record.mdxBody)) {
                if (!seen.has(reference.filename)) {
                    contentFilenames.push(reference.filename);
                    seen.add(reference.filename);
                }
            }
        } catch {
            // validateAlbumInventory already reports the MDX syntax diagnostic.
        }
        const contentFilenameSet = new Set(contentFilenames);
        const photos: ResolvedAlbumPhoto[] = record.manifest.photos.map((photo) => ({
            sourceAlbumSlug: slug,
            sourceAlbumTitle: record.manifest.title,
            filename: photo.filename,
            assetKey: `${slug}/${photo.filename}`,
            caption: photo.caption,
            tags: photo.tags.map((tag) => ({ ...tag })),
            isContent: contentFilenameSet.has(photo.filename),
        }));
        const photoByFilename = new Map(photos.map((photo) => [photo.filename, photo]));
        const contentPhotos = contentFilenames.flatMap((filename) => {
            const photo = photoByFilename.get(filename);
            return photo === undefined ? [] : [{ ...photo, isContent: true as const }];
        });
        const coverAssetKey = record.manifest.cover.photo.kind === "local"
            ? `${slug}/${record.manifest.cover.photo.filename}`
            : record.manifest.cover.photo.assetKey;
        const album: NormalizedAlbum = {
            schemaVersion: record.manifest.schemaVersion,
            title: record.manifest.title,
            info: record.manifest.info,
            publishedAt: record.manifest.publishedAt,
            order: record.manifest.order,
            gap: record.manifest.gap,
            slug,
            folder,
            albumId,
            cover: {
                ...record.manifest.cover,
                photo: { ...record.manifest.cover.photo },
                offset: { ...record.manifest.cover.offset },
                assetKey: coverAssetKey,
            },
            photos,
        };
        indexedBySlug.set(slug, { album, contentPhotos });
    }

    const albums = [...indexedBySlug.values()].map(({ album }) => album).sort(compareAlbums);
    const trackedAssetKeys = new Set(albums.flatMap((album) => album.photos.map(({ assetKey }) => assetKey)));

    for (const album of albums) {
        if (album.cover.photo.kind !== "external") continue;
        if (album.cover.photo.assetKey.startsWith(`${album.slug}/`)) {
            diagnostics.push({
                code: "external-cover-source-same-album",
                message: `External cover asset ${JSON.stringify(album.cover.photo.assetKey)} belongs to the consumer Album; use a local cover reference`,
                albumSlug: album.slug,
                sourcePath: sourceBySlug.get(album.slug)!.manifestPath,
                manifestPath: sourceBySlug.get(album.slug)!.manifestPath,
                fieldPath: "cover.photo.assetKey",
            });
        } else if (!trackedAssetKeys.has(album.cover.photo.assetKey)) {
            diagnostics.push({
                code: "external-cover-source-missing",
                message: `External cover asset ${JSON.stringify(album.cover.photo.assetKey)} is not tracked by any Album manifest inventory`,
                albumSlug: album.slug,
                sourcePath: sourceBySlug.get(album.slug)!.manifestPath,
                manifestPath: sourceBySlug.get(album.slug)!.manifestPath,
                fieldPath: "cover.photo.assetKey",
            });
        }
    }
    diagnostics.sort(compareDiagnostics);
    const diagnosticSnapshot = diagnostics.map(cloneDiagnostic);

    return {
        getAlbum(slug) {
            const album = indexedBySlug.get(slug as AlbumSlug)?.album;
            return album === undefined ? null : cloneAlbum(album);
        },
        getAlbums() {
            return albums.map(cloneAlbum);
        },
        getAlbumsInFolder(folder) {
            return albums.filter((album) => album.folder === folder).map(cloneAlbum);
        },
        getTaggedPhotos(tagName) {
            return albums.flatMap((album) =>
                indexedBySlug.get(album.slug)!.contentPhotos.filter((photo) =>
                    photo.tags.some(({ name }) => name === tagName),
                ).map(cloneTaggedPhoto)
            );
        },
        getExternalCoverReferences(assetKey) {
            return albums.flatMap((album) =>
                album.cover.photo.kind === "external" &&
                !album.cover.photo.assetKey.startsWith(`${album.slug}/`) &&
                album.cover.photo.assetKey === assetKey
                    ? [album.slug]
                    : [],
            );
        },
        get diagnostics() {
            return diagnosticSnapshot.map(cloneDiagnostic);
        },
    };
}
