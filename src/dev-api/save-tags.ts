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
import { json } from './_http';

type Tag = { name: string; x: number; y: number };
type TagMap = Record<string, Tag[]>;
export const POST: APIRoute = async ({ request }) => {
    let body: {
        albumSlug?: string;
        tagsMap?: unknown;
        newMountainRegions?: Record<string, MountainRegion>;
    };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON body' }, 400);
    }

    const { albumSlug, tagsMap } = body;
    if (!albumSlug) {
        return json({ error: 'Missing required fields' }, 400);
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
        return json({ error: error instanceof Error ? error.message : 'Invalid Album tags' }, 400);
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
        return json({
            error: `Choose a region for: ${missingRegions.join(', ')}`,
            unknownMountains: missingRegions,
        }, 400);
    }

    try {
        await replaceAlbumPhotoTags(cwd, albumSlug, normalizedTagMap);
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Unable to save Album tags' }, 400);
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

    return json({ success: true });
};
// Registered only by the local development server.
