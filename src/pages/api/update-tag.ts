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
        return new Response(JSON.stringify({ error: 'Missing required fields: photoId, tagName, x, y' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    // photoId format: "folder/album/filename.jpg"
    // e.g. "dalin/dalin-2025/01.jpg"
    const parts = photoId.split('/');
    if (parts.length < 3) {
        return new Response(JSON.stringify({ error: 'photoId must be in format folder/album/filename.jpg' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }
    const [folder, album] = parts;

    const fs = await import('node:fs');
    const path = await import('node:path');
    const cwd = process.cwd();

    // --- Update album tags JSON ---
    const tagsDir = path.resolve(cwd, 'src/album-tags', folder);
    const tagsFile = path.resolve(tagsDir, `${album}.json`);

    let tagsMap: Record<string, { name: string; x: number; y: number }[]> = {};
    if (fs.existsSync(tagsFile)) {
        try {
            tagsMap = JSON.parse(fs.readFileSync(tagsFile, 'utf-8'));
        } catch {
            // start fresh if corrupt
        }
    } else {
        // Ensure directory exists
        fs.mkdirSync(tagsDir, { recursive: true });
    }

    if (!tagsMap[photoId]) {
        tagsMap[photoId] = [];
    }
    tagsMap[photoId].push({ name: tagName, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });

    fs.writeFileSync(tagsFile, JSON.stringify(tagsMap, null, 2), 'utf-8');

    // --- Update mountains.json ---
    interface MountainEntry {
        name: string;
        elevation: number | null;
        description: string;
    }

    const mountainsFile = path.resolve(cwd, 'src/mountains.json');
    let mountains: MountainEntry[] = [];
    if (fs.existsSync(mountainsFile)) {
        try {
            mountains = JSON.parse(fs.readFileSync(mountainsFile, 'utf-8'));
        } catch {
            mountains = [];
        }
    }

    const alreadyExists = mountains.some((m) => m.name === tagName);
    if (!alreadyExists) {
        mountains.push({ name: tagName, elevation: null, description: '' });
        mountains.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
        fs.writeFileSync(mountainsFile, JSON.stringify(mountains, null, 2), 'utf-8');
    }

    return new Response(
        JSON.stringify({ success: true, photoId, tagName, x, y }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
};
