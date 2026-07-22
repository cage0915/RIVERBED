import { normalizeAssetKey, validateAlbumSlug, validateLocalPhotoFilename } from "./keys.ts";
import type {
    AlbumManifest,
    ExternalCoverPhoto,
    LocalCoverPhoto,
    PhotoTag,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`${field} must be an object`);
    return value;
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string") throw new Error(`${field} must be a string`);
    return value;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function requireFiniteNumber(value: unknown, field: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`${field} must be a finite number`);
    }
    return value;
}

function requireCoordinate(value: unknown, field: string): number {
    const coordinate = requireFiniteNumber(value, field);
    if (coordinate < 0 || coordinate > 100) {
        throw new Error(`${field} must be between 0 and 100`);
    }
    return coordinate;
}

function isIsoDate(value: string): boolean {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day;
}

function parseTag(value: unknown, index: number): PhotoTag {
    const tag = requireRecord(value, `tag ${index}`);
    const name = requireString(tag.name, `tag ${index} name`);
    if (!name.trim()) throw new Error(`tag ${index} name must not be empty`);
    return {
        name,
        x: requireCoordinate(tag.x, `tag ${index} x`),
        y: requireCoordinate(tag.y, `tag ${index} y`),
    };
}

function parseCoverPhoto(value: unknown): LocalCoverPhoto | ExternalCoverPhoto {
    const photo = requireRecord(value, "cover photo");
    if (photo.kind === "local") {
        return {
            kind: "local",
            filename: validateLocalPhotoFilename(requireString(photo.filename, "cover photo filename")),
        };
    }
    if (photo.kind === "external") {
        return {
            kind: "external",
            assetKey: normalizeAssetKey(requireString(photo.assetKey, "cover photo asset key")),
        };
    }
    throw new Error("cover photo has an unsupported kind");
}

export function parseAlbumManifest(input: unknown, albumSlug: string): AlbumManifest {
    validateAlbumSlug(albumSlug);
    const manifest = requireRecord(input, "album manifest");

    if (manifest.schemaVersion !== 1) {
        throw new Error("album manifest has an unsupported schemaVersion");
    }
    const title = requireString(manifest.title, "title");
    if (!title.trim()) throw new Error("title must not be empty");

    const publishedAt = optionalString(manifest.publishedAt, "publishedAt");
    if (publishedAt !== undefined && !isIsoDate(publishedAt)) {
        throw new Error("publishedAt must be an ISO YYYY-MM-DD date");
    }

    const order = requireFiniteNumber(manifest.order, "order");
    if (!Number.isInteger(order)) throw new Error("order must be an integer");

    const coverInput = requireRecord(manifest.cover, "cover");
    const coverPhoto = parseCoverPhoto(coverInput.photo);
    const zoom = requireFiniteNumber(coverInput.zoom, "cover zoom");
    if (zoom <= 0) throw new Error("cover zoom must be positive");
    const offsetInput = requireRecord(coverInput.offset, "cover offset");
    const offset = {
        x: requireCoordinate(offsetInput.x, "cover offset x"),
        y: requireCoordinate(offsetInput.y, "cover offset y"),
    };

    if (!Array.isArray(manifest.photos)) throw new Error("photos must be an array");
    const filenames = new Set<string>();
    const photos = manifest.photos.map((value, photoIndex) => {
        const photo = requireRecord(value, `photo ${photoIndex}`);
        const filename = validateLocalPhotoFilename(
            requireString(photo.filename, `photo ${photoIndex} filename`),
        );
        if (filenames.has(filename)) throw new Error(`Duplicate photo filename: ${filename}`);
        filenames.add(filename);

        const tagValues = photo.tags === undefined ? [] : photo.tags;
        if (!Array.isArray(tagValues)) throw new Error(`photo ${photoIndex} tags must be an array`);
        return {
            filename,
            caption: optionalString(photo.caption, `photo ${photoIndex} caption`),
            tags: tagValues.map((tag, tagIndex) => parseTag(tag, tagIndex)),
        };
    });

    if (coverPhoto.kind === "local" && !filenames.has(coverPhoto.filename)) {
        throw new Error("Local cover filename must be present in photos");
    }

    return {
        schemaVersion: 1,
        title,
        info: optionalString(manifest.info, "info"),
        publishedAt,
        order,
        gap: optionalString(manifest.gap, "gap"),
        cover: { photo: coverPhoto, zoom, offset },
        photos,
    };
}
