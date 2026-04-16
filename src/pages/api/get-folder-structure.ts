import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import fs from 'node:fs';
import path from 'node:path';
import { getAvailableFolders } from '../../lib/album-utils';

export const GET: APIRoute = async ({ url }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

    const folder = url.searchParams.get('folder');
    if (!folder) {
        return new Response(JSON.stringify({ error: 'Missing folder parameter' }), { status: 400 });
    }

    try {
        // 1. Get existing albums from content collection
        const allAlbums = await getCollection('albums');
        const folderAlbums = allAlbums.filter(a => a.slug.startsWith(`${folder}/`));

        // 2. Try to load the stored order
        const orderFilePath = path.resolve(process.cwd(), 'src/content/albums', folder, '_order.json');
        let order: string[] = [];
        if (fs.existsSync(orderFilePath)) {
            try {
                order = JSON.parse(fs.readFileSync(orderFilePath, 'utf8'));
            } catch (e) {
                console.error(`Failed to parse _order.json for ${folder}:`, e);
            }
        }

        // 3. Sort albums based on order
        const sortedAlbums = folderAlbums.sort((a, b) => {
            const slugA = a.slug.split('/')[1];
            const slugB = b.slug.split('/')[1];
            
            const idxA = order.indexOf(slugA);
            const idxB = order.indexOf(slugB);

            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;

            // Fallback to title
            return a.data.title.localeCompare(b.data.title);
        }).map(a => ({
            id: a.id,
            slug: a.slug,
            title: a.data.title,
            info: a.data.info,
            coverKey: a.data.coverKey
        }));

        // 4. Get available folders for new albums
        const candidates = getAvailableFolders(folder);

        return new Response(JSON.stringify({
            albums: sortedAlbums,
            availableFolders: candidates
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (err) {
        console.error(err);
        return new Response(JSON.stringify({ error: 'Server error' }), { status: 500 });
    }
};
