import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
    // Only allow in dev mode
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: { action: 'update' | 'delete'; photoId?: string; tagName?: string; x?: number; y?: number };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { action, photoId, tagName, x, y } = body;

    if (!action || !photoId || !tagName || x == null || y == null) {
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
    const filename = filenameParts.join("/");

    const fs = await import('node:fs');
    const path = await import('node:path');
    const cwd = process.cwd();
    const tagsDir = path.resolve(cwd, 'src/album-tags', folder);
    const tagsFile = path.resolve(tagsDir, `${album}.json`);

    let tagsMap: Record<string, { name: string; x: number; y: number }[]> = {};
    if (fs.existsSync(tagsFile)) {
        try {
            tagsMap = JSON.parse(fs.readFileSync(tagsFile, 'utf-8'));
        } catch { }
    } else {
        if (action === 'delete') {
            return new Response(JSON.stringify({ error: 'File not found' }), { status: 404, headers: { 'Content-Type': 'application/json' }});
        }
        fs.mkdirSync(tagsDir, { recursive: true });
    }

    const tagKey = filename || photoId;

    if (action === 'delete') {
        if (tagsMap[tagKey]) {
            tagsMap[tagKey] = tagsMap[tagKey].filter(t =>
                !(t.name === tagName && Math.abs(t.x - (x ?? 0)) < 0.1 && Math.abs(t.y - (y ?? 0)) < 0.1)
            );
            if (tagsMap[tagKey].length === 0) {
                delete tagsMap[tagKey];
            }
            fs.writeFileSync(tagsFile, JSON.stringify(tagsMap, null, 2), 'utf-8');
        }
    } else {
        // action === 'update'
        if (!tagsMap[tagKey]) {
            tagsMap[tagKey] = [];
        }
        tagsMap[tagKey].push({ name: tagName, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
        fs.writeFileSync(tagsFile, JSON.stringify(tagsMap, null, 2), 'utf-8');

        // Update mountains.json
        interface MountainEntry { name: string; elevation: number | null; description: string; }
        const mountainsFile = path.resolve(cwd, 'src/mountains.json');
        let mountains: MountainEntry[] = [];
        if (fs.existsSync(mountainsFile)) {
            try { mountains = JSON.parse(fs.readFileSync(mountainsFile, 'utf-8')); } catch { mountains = []; }
        }
        const alreadyExists = mountains.some((m) => m.name === tagName);
        if (!alreadyExists) {
            mountains.push({ name: tagName, elevation: null, description: '' });
            mountains.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
            fs.writeFileSync(mountainsFile, JSON.stringify(mountains, null, 2), 'utf-8');
        }
    }

    return new Response(
        JSON.stringify({ success: true }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
};
