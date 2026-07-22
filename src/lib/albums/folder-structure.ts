import type { AlbumManifest } from "./types.ts";

export type FolderAlbum = {
    id: string;
    slug: string;
    title: string;
    info?: string;
    coverKey: string;
    coverZoom: number;
    coverOffset: { x: number; y: number };
};

export function createFolderStructure(
    manifests: Record<string, AlbumManifest>,
    folder: string,
): FolderAlbum[] {
    return Object.entries(manifests)
        .filter(([slug]) => slug.startsWith(`${folder}/`))
        .sort(([leftSlug, left], [rightSlug, right]) =>
            left.order - right.order || leftSlug.localeCompare(rightSlug)
        )
        .map(([slug, manifest]) => ({
            id: slug.slice(folder.length + 1),
            slug,
            title: manifest.title,
            info: manifest.info,
            coverKey: manifest.cover.photo.kind === "local"
                ? `${slug}/${manifest.cover.photo.filename}`
                : manifest.cover.photo.assetKey,
            coverZoom: manifest.cover.zoom,
            coverOffset: { ...manifest.cover.offset },
        }));
}
