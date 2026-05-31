import type { APIRoute } from 'astro';

import {
    collectTagNames,
    mergeMountainEntries,
    normalizeTagMap,
} from '../../lib/dev-tag-state.js';

type Tag = { name: string; x: number; y: number };
type TagMap = Record<string, Tag[]>;
type MountainEntry = { name: string; elevation: number | null; description: string };

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: { albumSlug?: string; tagsMap?: TagMap };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const { albumSlug, tagsMap } = body;
    if (!albumSlug || !tagsMap || typeof tagsMap !== 'object') {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const parts = albumSlug.split('/');
    if (parts.length !== 2) {
        return new Response(JSON.stringify({ error: 'Invalid albumSlug' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const [folder, album] = parts;
    const fs = await import('node:fs');
    const path = await import('node:path');
    const cwd = process.cwd();

    const tagsDir = path.resolve(cwd, 'src/album-tags', folder);
    const tagsFile = path.resolve(tagsDir, `${album}.json`);
    const normalizedTagMap = normalizeTagMap(tagsMap);

    fs.mkdirSync(tagsDir, { recursive: true });
    fs.writeFileSync(tagsFile, JSON.stringify(normalizedTagMap, null, 2), 'utf-8');

    const mountainsFile = path.resolve(cwd, 'src/mountains.json');
    let mountains: MountainEntry[] = [];
    if (fs.existsSync(mountainsFile)) {
        try {
            mountains = JSON.parse(fs.readFileSync(mountainsFile, 'utf-8'));
        } catch {
            mountains = [];
        }
    }

    const nextMountains = mergeMountainEntries(mountains, collectTagNames(normalizedTagMap));
    if (JSON.stringify(nextMountains) !== JSON.stringify(mountains)) {
        fs.writeFileSync(mountainsFile, JSON.stringify(nextMountains, null, 2), 'utf-8');
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};