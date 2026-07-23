import type { AlbumManifest } from './albums/types.ts';

export type R2ReferenceKind = 'album-photo' | 'album-cover' | 'mountain-cover';

export type R2SourceReference = {
    key: string;
    kind: R2ReferenceKind;
    source: string;
    label?: string;
};

export type R2SourceIndex = Map<string, R2SourceReference[]>;

export function resolveAlbumAssetKey(albumSlug: string, filename: string) {
    return `${albumSlug}/${filename}`;
}

export function collectAlbumReferences(albumSlug: string, manifest: AlbumManifest): R2SourceReference[] {
    const source = `src/album-manifests/${albumSlug}.json`;
    const references: R2SourceReference[] = manifest.photos.map(({ filename }) => ({
        key: resolveAlbumAssetKey(albumSlug, filename),
        kind: 'album-photo' as const,
        source,
    }));
    references.push({
        key: manifest.cover.photo.kind === 'local'
            ? resolveAlbumAssetKey(albumSlug, manifest.cover.photo.filename)
            : manifest.cover.photo.assetKey,
        kind: 'album-cover',
        source,
    });
    return references;
}

export function collectMountainReferences(source: string, value: unknown): R2SourceReference[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
        if (!entry || typeof entry !== 'object') return [];
        const mountain = entry as { name?: unknown; coverKey?: unknown };
        if (typeof mountain.coverKey !== 'string' || !mountain.coverKey.trim()) return [];
        return [{
            key: mountain.coverKey.trim().replace(/^\/+/, ''),
            kind: 'mountain-cover' as const,
            source,
            label: typeof mountain.name === 'string' ? mountain.name : undefined,
        }];
    });
}

export function buildR2SourceIndex(references: R2SourceReference[]): R2SourceIndex {
    const index: R2SourceIndex = new Map();
    for (const reference of references) {
        const current = index.get(reference.key) || [];
        current.push(reference);
        index.set(reference.key, current);
    }
    return index;
}

export function classifyRemoteObjects<T extends { key: string }>(objects: T[], sourceIndex: R2SourceIndex) {
    return {
        trash: objects.filter((object) => object.key.startsWith('_trash/')),
        directoryMarkers: objects.filter((object) => !object.key.startsWith('_trash/') && object.key.endsWith('/')),
        orphans: objects.filter((object) =>
            !object.key.startsWith('_trash/') &&
            !object.key.endsWith('/') &&
            !sourceIndex.has(object.key)
        ),
    };
}
