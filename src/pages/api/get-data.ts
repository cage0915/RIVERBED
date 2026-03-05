import type { APIRoute } from 'astro';
import mountains from '../../mountains.json';
const tagFiles = import.meta.glob('/src/album-tags/**/*.json', { eager: true });


export const GET: APIRoute = async () => {
    const allTags: Record<string, any> = {};

    for (const path in tagFiles) {
        // Transform path from '/src/album-tags/folder/album.json' to 'folder/album'
        const match = path.match(/\/src\/album-tags\/(.*)\.json/);
        if (match) {
            allTags[match[1]] = (tagFiles[path] as any).default;
        }
    }

    return new Response(
        JSON.stringify({ mountains, allTags }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }
    );
};

