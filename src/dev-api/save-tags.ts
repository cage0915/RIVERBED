import type { APIRoute } from 'astro';

import {
    collectTagNames,
    findNewTagNames,
    normalizeTagMap,
} from '../lib/dev-tag-state.js';
import {
    isMountainRegion,
    readAllMountainRegions,
    readMountainRegion,
    writeMountainRegion,
} from '../lib/mountain-files';
import type { MountainRegion } from '../lib/mountains';

type Tag = { name: string; x: number; y: number };
type TagMap = Record<string, Tag[]>;
export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    let body: {
        albumSlug?: string;
        tagsMap?: TagMap;
        newMountainRegions?: Record<string, MountainRegion>;
    };
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
    const previousTagMap = fs.existsSync(tagsFile)
        ? normalizeTagMap(JSON.parse(fs.readFileSync(tagsFile, 'utf-8')) as TagMap)
        : {};
    const newTagNames = new Set(findNewTagNames(previousTagMap, normalizedTagMap));

    const allMountains = await readAllMountainRegions();
    const existingNames = new Set(allMountains.map((mountain) => mountain.name));
    const unknownNames = collectTagNames(normalizedTagMap).filter(
        (name) => !existingNames.has(name),
    );
    const missingRegions = unknownNames.filter(
        (name) =>
            newTagNames.has(name) &&
            !isMountainRegion(body.newMountainRegions?.[name]),
    );
    if (missingRegions.length > 0) {
        return new Response(
            JSON.stringify({
                error: `Choose a region for: ${missingRegions.join(', ')}`,
                unknownMountains: missingRegions,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }

    fs.mkdirSync(tagsDir, { recursive: true });
    fs.writeFileSync(tagsFile, JSON.stringify(normalizedTagMap, null, 2), 'utf-8');

    const targetRegions = [...new Set(
        unknownNames.map((name) => body.newMountainRegions?.[name]),
    )].filter(isMountainRegion);
    for (const region of targetRegions) {
        const names = unknownNames.filter(
            (name) => body.newMountainRegions?.[name] === region,
        );
        if (names.length === 0) continue;
        const mountains = await readMountainRegion(region);
        mountains.push(
            ...names.map((name) => ({
                name,
                elevation: null,
                description: '',
            })),
        );
        await writeMountainRegion(region, mountains);
    }

    return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
};
// Registered only by the local development server.
