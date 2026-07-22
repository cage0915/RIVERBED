import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

const IMAGE_PATTERN = /\.(?:jpe?g|png|webp|avif)$/i;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});
const safeSegment = (value: string) =>
    value.length > 0 && value !== '.' && value !== '..' && !value.includes('/') && !value.includes('\\') && !value.includes('\0');

const resolveAlbumDirectory = (r2Root: string, albumSlug: string) => {
    const parts = albumSlug.split('/');
    if (parts.length !== 2 || !parts.every(safeSegment)) return null;
    const directory = path.resolve(r2Root, ...parts);
    return directory.startsWith(`${r2Root}${path.sep}`) ? directory : null;
};

export const GET: APIRoute = async ({ url }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);

    const r2Root = path.resolve(process.cwd(), 'r2');
    if (!fs.existsSync(r2Root)) return json({ albums: [], photos: [] });

    const albums = fs.readdirSync(r2Root, { withFileTypes: true })
        .filter((folder) => folder.isDirectory() && safeSegment(folder.name))
        .flatMap((folder) => {
            const folderPath = path.join(r2Root, folder.name);
            return fs.readdirSync(folderPath, { withFileTypes: true })
                .filter((album) => album.isDirectory() && safeSegment(album.name))
                .map((album) => {
                    const albumPath = path.join(folderPath, album.name);
                    const count = fs.readdirSync(albumPath, { withFileTypes: true })
                        .filter((entry) => entry.isFile() && IMAGE_PATTERN.test(entry.name)).length;
                    return { slug: `${folder.name}/${album.name}`, count };
                })
                .filter((album) => album.count > 0);
        })
        .sort((left, right) => left.slug.localeCompare(right.slug, undefined, { numeric: true, sensitivity: 'base' }));

    const requestedSlug = url.searchParams.get('albumSlug') || '';
    if (!requestedSlug) return json({ albums, photos: [] });

    const directory = resolveAlbumDirectory(r2Root, requestedSlug);
    if (!directory) return json({ error: 'Invalid R2 album folder' }, 400);
    if (!fs.existsSync(directory)) return json({ albums, albumSlug: requestedSlug, photos: [] });

    const photos = fs.readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && IMAGE_PATTERN.test(entry.name))
        .map((entry) => ({ name: entry.name, key: `${requestedSlug}/${entry.name}` }))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }));

    return json({ albums, albumSlug: requestedSlug, photos });
};
// Registered only by the local development server.
