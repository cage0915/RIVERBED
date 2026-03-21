import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
    // Only allow in dev mode
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: { photoId?: string; tagName?: string; x?: number; y?: number };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { photoId, tagName, x, y } = body;

    if (!photoId || !tagName || x == null || y == null) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const parts = photoId.split('/');
    if (parts.length < 3) {
        return new Response(JSON.stringify({ error: 'Invalid photoId' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    const [folder, album, ...filenameParts] = parts;
    const filename = filenameParts.join("/"); // e.g. "KCS00743.jpg"

    const fs = await import('node:fs');
    const path = await import('node:path');
    const cwd = process.cwd();
    const tagsFile = path.resolve(cwd, 'src/album-tags', folder, `${album}.json`);

    if (!fs.existsSync(tagsFile)) {
        return new Response(JSON.stringify({ error: 'File not found' }), {
            status: 404,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let tagsMap: Record<string, { name: string; x: number; y: number }[]> = {};
    try {
        tagsMap = JSON.parse(fs.readFileSync(tagsFile, 'utf-8'));
    } catch {
        return new Response(JSON.stringify({ error: 'Error reading file' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // Use just the filename as the key (new relative format)
    const tagKey = filename || photoId;
    if (tagsMap[tagKey]) {
        // Filter out the tag that matches name, x, and y (approximate match for coordinates)
        tagsMap[tagKey] = tagsMap[tagKey].filter(t =>
            !(t.name === tagName && Math.abs(t.x - (x ?? 0)) < 0.1 && Math.abs(t.y - (y ?? 0)) < 0.1)
        );

        // If no tags left for this photo, remove the key.
        if (tagsMap[tagKey].length === 0) {
            delete tagsMap[tagKey];
        }

        fs.writeFileSync(tagsFile, JSON.stringify(tagsMap, null, 2), 'utf-8');
    }

    return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
};
