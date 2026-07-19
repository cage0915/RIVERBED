export type R2ReferenceKind = 'album-photo' | 'album-cover' | 'mountain-cover';

export type R2SourceReference = {
    key: string;
    kind: R2ReferenceKind;
    source: string;
    label?: string;
};

export type R2SourceIndex = Map<string, R2SourceReference[]>;

export function resolveAlbumAssetKey(albumSlug: string, itemKey: string) {
    const value = itemKey.trim().replace(/^\/+/, '');
    return value.includes('/') ? value : `${albumSlug}/${value}`;
}

export function collectAlbumReferences(albumSlug: string, content: string): R2SourceReference[] {
    const references: R2SourceReference[] = [];
    const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || '';
    const coverKey = frontmatter.match(/^coverKey:\s*["']([^"']+)["']/m)?.[1];
    if (coverKey) {
        references.push({
            key: resolveAlbumAssetKey(albumSlug, coverKey),
            kind: 'album-cover',
            source: `src/content/albums/${albumSlug}.mdx`,
        });
    }

    const photoPattern = /<Photo\s+[^>]*?itemKey=["']([^"']+)["'][^>]*?\/?\s*>/g;
    let match: RegExpExecArray | null;
    while ((match = photoPattern.exec(content)) !== null) {
        references.push({
            key: resolveAlbumAssetKey(albumSlug, match[1]),
            kind: 'album-photo',
            source: `src/content/albums/${albumSlug}.mdx`,
        });
    }
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
