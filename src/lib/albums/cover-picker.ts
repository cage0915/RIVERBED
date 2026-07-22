import type { AlbumManifest } from "./types.ts";

export function createCoverPickerInventory(
    manifests: Record<string, AlbumManifest>,
    requestedSlug = "",
) {
    const albums = Object.entries(manifests)
        .map(([slug, manifest]) => ({ slug, count: manifest.photos.length }))
        .filter(({ count }) => count > 0)
        .sort((left, right) => left.slug.localeCompare(right.slug, undefined, {
            numeric: true,
            sensitivity: "base",
        }));
    const manifest = manifests[requestedSlug];
    const photos = manifest?.photos.map(({ filename }) => ({
        name: filename,
        key: `${requestedSlug}/${filename}`,
    })).sort((left, right) => left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base",
    })) ?? [];
    return { albums, albumSlug: requestedSlug, photos };
}
