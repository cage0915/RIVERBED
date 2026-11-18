import { getAlbumCatalog, getAlbumSummaries } from "./catalog";

export interface PostVolumes {
    /** Photo count per post for each folder, oldest post first. */
    byFolder: Map<string, number[]>;
    /** Largest photo count across every folder: the shared vertical scale. */
    max: number;
}

/**
 * Photo counts behind the post-volume curves. The folder page lists posts by
 * descending `order`, so ascending `order` puts the oldest post first.
 */
export async function getPostVolumes(): Promise<PostVolumes> {
    const [summaries, catalog] = await Promise.all([getAlbumSummaries(), getAlbumCatalog()]);

    const byFolder = new Map<string, number[]>();
    const sorted = [...summaries].sort(
        (a, b) => a.order - b.order || b.slug.localeCompare(a.slug),
    );
    for (const album of sorted) {
        const folder = album.slug.split("/")[0];
        const counts = byFolder.get(folder) ?? [];
        counts.push(catalog.getAlbum(album.slug)?.photos.length ?? 0);
        byFolder.set(folder, counts);
    }

    return { byFolder, max: Math.max(0, ...[...byFolder.values()].flat()) };
}
