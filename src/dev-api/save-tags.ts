import type { APIRoute } from 'astro';

import {
    collectTagNames,
    findNewTagNames,
    parseTagMapInput,
} from '../lib/dev-tag-state.js';
import {
    readAlbumManifestFile,
    replaceAlbumPhotoTags,
} from '../lib/albums/manifest-files';
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
        tagsMap?: unknown;
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
    if (!albumSlug) {
        return new Response(JSON.stringify({ error: 'Missing required fields' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
        });
    }

    const cwd = process.cwd();
    let normalizedTagMap: TagMap;
    let previousTagMap: TagMap;
    try {
        normalizedTagMap = parseTagMapInput(tagsMap);
        const manifest = await readAlbumManifestFile(cwd, albumSlug);
        previousTagMap = Object.fromEntries(
            manifest.photos
                .filter((photo) => photo.tags.length > 0)
                .map((photo) => [photo.filename, photo.tags]),
        );
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Invalid Album tags' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }
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

    try {
        await replaceAlbumPhotoTags(cwd, albumSlug, normalizedTagMap);
    } catch (error) {
        return new Response(
            JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to save Album tags' }),
            { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
    }

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
