/**
 * @typedef {{ name: string; x: number; y: number }} Tag
 * @typedef {{ name: string; elevation: number | null; description: string }} MountainEntry
 * @typedef {Record<string, Tag[]>} TagMap
 */

import { validateLocalPhotoFilename } from './albums/keys.ts';

const TAG_EPSILON = 0.1;

/**
 * @param {number} value
 */
function roundCoord(value) {
    return Math.round(value * 100) / 100;
}

/**
 * @param {Tag} tag
 * @returns {Tag}
 */
function normalizeTag(tag) {
    return {
        name: tag.name,
        x: roundCoord(tag.x),
        y: roundCoord(tag.y),
    };
}

/**
 * @param {Tag} left
 * @param {Tag} right
 */
function isSameTag(left, right) {
    return (
        left.name === right.name
        && Math.abs(left.x - right.x) < TAG_EPSILON
        && Math.abs(left.y - right.y) < TAG_EPSILON
    );
}

/**
 * @param {TagMap} tagMap
 * @returns {TagMap}
 */
function cloneTagMap(tagMap) {
    return Object.fromEntries(
        Object.entries(tagMap).map(([photoKey, tags]) => [
            photoKey,
            tags.map((tag) => ({ ...tag })),
        ]),
    );
}

/**
 * @param {TagMap} tagMap
 * @param {string} photoKey
 * @param {Tag} nextTag
 * @param {Tag} [previousTag]
 * @returns {TagMap}
 */
export function addOrUpdateTag(tagMap, photoKey, nextTag, previousTag = undefined) {
    const nextMap = cloneTagMap(tagMap);
    const normalizedNext = normalizeTag(nextTag);
    const currentTags = nextMap[photoKey] || [];
    const filteredTags = previousTag
        ? currentTags.filter((tag) => !isSameTag(tag, previousTag))
        : currentTags;

    nextMap[photoKey] = [...filteredTags, normalizedNext];
    return normalizeTagMap(nextMap);
}

/**
 * @param {TagMap} tagMap
 * @param {string} photoKey
 * @param {Tag} tagToDelete
 * @returns {TagMap}
 */
export function deleteTag(tagMap, photoKey, tagToDelete) {
    const nextMap = cloneTagMap(tagMap);
    const currentTags = nextMap[photoKey] || [];
    nextMap[photoKey] = currentTags.filter((tag) => !isSameTag(tag, tagToDelete));
    return normalizeTagMap(nextMap);
}

/**
 * @param {TagMap} tagMap
 * @returns {TagMap}
 */
export function normalizeTagMap(tagMap) {
    return Object.fromEntries(
        Object.entries(tagMap)
            .map(([photoKey, tags]) => [
                photoKey,
                tags.map(normalizeTag),
            ])
            .filter(([, tags]) => tags.length > 0),
    );
}

/**
 * Validate untrusted request data before normalizing it as a tag map.
 * @param {unknown} input
 * @returns {TagMap}
 */
export function parseTagMapInput(input) {
    if (
        typeof input !== 'object'
        || input === null
        || Array.isArray(input)
        || ![Object.prototype, null].includes(Object.getPrototypeOf(input))
    ) {
        throw new Error('Invalid tagsMap');
    }

    /** @type {TagMap} */
    const normalized = {};
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

/**
 * @param {MountainEntry[]} mountains
 * @param {string[]} tagNames
 * @returns {MountainEntry[]}
 */
export function mergeMountainEntries(mountains, tagNames) {
    const seenNames = new Set(mountains.map((mountain) => mountain.name));
    const additions = [];

    for (const tagName of tagNames) {
        if (!seenNames.has(tagName)) {
            seenNames.add(tagName);
            additions.push({ name: tagName, elevation: null, description: '' });
        }
    }

    return [...mountains, ...additions].sort((left, right) => left.name.localeCompare(right.name, 'zh-Hant'));
}

/**
 * @param {TagMap} tagMap
 * @returns {string[]}
 */
export function collectTagNames(tagMap) {
    return [...new Set(Object.values(tagMap).flat().map((tag) => tag.name))];
}

/**
 * @param {TagMap} previousTagMap
 * @param {TagMap} nextTagMap
 * @returns {string[]}
 */
export function findNewTagNames(previousTagMap, nextTagMap) {
    const previousNames = new Set(collectTagNames(previousTagMap));
    return collectTagNames(nextTagMap).filter((name) => !previousNames.has(name));
}
