import { validateLocalPhotoFilename } from './albums/keys.ts';

export type Tag = { name: string; x: number; y: number };
export type MountainEntry = { name: string; elevation: number | null; description: string };
export type TagMap = Record<string, Tag[]>;

const TAG_EPSILON = 0.1;

function roundCoord(value: number) {
    return Math.round(value * 100) / 100;
}

function normalizeTag(tag: Tag): Tag {
    return {
        name: tag.name,
        x: roundCoord(tag.x),
        y: roundCoord(tag.y),
    };
}

function isSameTag(left: Tag, right: Tag) {
    return (
        left.name === right.name
        && Math.abs(left.x - right.x) < TAG_EPSILON
        && Math.abs(left.y - right.y) < TAG_EPSILON
    );
}

function cloneTagMap(tagMap: TagMap): TagMap {
    return Object.fromEntries(
        Object.entries(tagMap).map(([photoKey, tags]) => [
            photoKey,
            tags.map((tag) => ({ ...tag })),
        ]),
    );
}

export function addOrUpdateTag(
    tagMap: TagMap,
    photoKey: string,
    nextTag: Tag,
    previousTag?: Tag,
): TagMap {
    const nextMap = cloneTagMap(tagMap);
    const normalizedNext = normalizeTag(nextTag);
    const currentTags = nextMap[photoKey] || [];
    const filteredTags = previousTag
        ? currentTags.filter((tag) => !isSameTag(tag, previousTag))
        : currentTags;

    nextMap[photoKey] = [...filteredTags, normalizedNext];
    return normalizeTagMap(nextMap);
}

export function deleteTag(tagMap: TagMap, photoKey: string, tagToDelete: Tag): TagMap {
    const nextMap = cloneTagMap(tagMap);
    const currentTags = nextMap[photoKey] || [];
    nextMap[photoKey] = currentTags.filter((tag) => !isSameTag(tag, tagToDelete));
    return normalizeTagMap(nextMap);
}

export function normalizeTagMap(tagMap: TagMap): TagMap {
    return Object.fromEntries(
        Object.entries(tagMap)
            .map(([photoKey, tags]) => [
                photoKey,
                tags.map(normalizeTag),
            ])
            .filter(([, tags]) => tags.length > 0),
    );
}

/** Validate untrusted request data before normalizing it as a tag map. */
export function parseTagMapInput(input: unknown): TagMap {
    if (
        typeof input !== 'object'
        || input === null
        || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
        throw new Error('Invalid tagsMap');
    }

    const normalized: TagMap = {};
    for (const [filename, tags] of Object.entries(input)) {
        validateLocalPhotoFilename(filename);
        if (!Array.isArray(tags)) throw new Error('Invalid tagsMap');
        for (const tag of tags) {
            if (
                typeof tag !== 'object'
                || tag === null
                || Array.isArray(tag)
                || typeof tag.name !== 'string'
                || !tag.name.trim()
                || typeof tag.x !== 'number'
                || !Number.isFinite(tag.x)
                || tag.x < 0
                || tag.x > 100
                || typeof tag.y !== 'number'
                || !Number.isFinite(tag.y)
                || tag.y < 0
                || tag.y > 100
            ) {
                throw new Error('Invalid tagsMap');
            }
        }
        normalized[filename] = tags.map(normalizeTag);
    }
    return normalized;
}

export function mergeMountainEntries(mountains: MountainEntry[], tagNames: string[]): MountainEntry[] {
    const seenNames = new Set(mountains.map((mountain) => mountain.name));
    const additions: MountainEntry[] = [];

    for (const tagName of tagNames) {
        if (!seenNames.has(tagName)) {
            seenNames.add(tagName);
            additions.push({ name: tagName, elevation: null, description: '' });
        }
    }

    return [...mountains, ...additions].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
}

export function collectTagNames(tagMap: TagMap): string[] {
    return [...new Set(Object.values(tagMap).flat().map((tag) => tag.name))];
}

export function findNewTagNames(previousTagMap: TagMap, nextTagMap: TagMap): string[] {
    const previousNames = new Set(collectTagNames(previousTagMap));
    return collectTagNames(nextTagMap).filter((name) => !previousNames.has(name));
}
