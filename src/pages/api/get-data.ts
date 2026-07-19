import type { APIRoute } from 'astro';
import {
    allMountains as mountains,
    MOUNTAIN_REGION_DEFINITIONS as regions,
} from '../../lib/mountains';
const tagFiles = import.meta.glob('/src/album-tags/**/*.json', { eager: true });


export const GET: APIRoute = async () => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const allTags: Record<string, any> = {};

    for (const path in tagFiles) {
        // Transform path from '/src/album-tags/folder/album.json' to 'folder/album'
        const match = path.match(/\/src\/album-tags\/(.*)\.json/);
        if (match) {
            allTags[match[1]] = (tagFiles[path] as any).default;
        }
    }

    return new Response(
        JSON.stringify({ mountains, regions, allTags }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }
    );
};
