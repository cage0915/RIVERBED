import { normalizeAssetKey, validateAlbumSlug, validateLocalPhotoFilename } from "./keys.ts";
import type {
    AlbumBlock,
    AlbumManifest,
    ExternalCoverPhoto,
    LocalCoverPhoto,
    PhotoCarouselBlock,
    PhotoPanoramaBlock,
    PhotoTag,
    RowBlock,
    TextBlock,
} from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw new Error(`${field} must be an object`);
    return value;
}

function rejectUnknownFields(
    value: Record<string, unknown>,
    allowed: readonly string[],
    field: string,
): void {
    const allowedSet = new Set(allowed);
    const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
    if (unknown !== undefined) throw new Error(`${field} has unknown field: ${unknown}`);
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

function optionalHexColor(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    const color = requireString(value, field);
    if (!/^#[0-9a-f]{6}$/.test(color)) {
        throw new Error(`${field} must be a lowercase #rrggbb colour`);
    }
    return color;
}

function optionalPositiveInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined;
    const number = requireFiniteNumber(value, field);
    if (!Number.isInteger(number) || number <= 0) {
        throw new Error(`${field} must be a positive integer`);
    }
    return number;
}

function optionalIntegerInRange(
    value: unknown,
    field: string,
    min: number,
    max: number,
): number | undefined {
    if (value === undefined) return undefined;
    const number = requireFiniteNumber(value, field);
    if (!Number.isInteger(number) || number < min || number > max) {
        throw new Error(`${field} must be an integer from ${min} to ${max}`);
    }
    return number;
}

function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], field: string): T | undefined {
    if (value === undefined) return undefined;
    if (!allowed.includes(value as T)) throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
    return value as T;
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
    rejectUnknownFields(tag, ["name", "x", "y"], `tag ${index}`);
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
        rejectUnknownFields(photo, ["kind", "filename"], "cover photo");
        return {
            kind: "local",
            filename: validateLocalPhotoFilename(requireString(photo.filename, "cover photo filename")),
        };
    }
    if (photo.kind === "external") {
        rejectUnknownFields(photo, ["kind", "assetKey"], "cover photo");
        return {
            kind: "external",
            assetKey: normalizeAssetKey(requireString(photo.assetKey, "cover photo asset key")),
        };
    }
    throw new Error("cover photo has an unsupported kind");
}

function parseBlockPhoto(value: unknown, field: string): string {
    try {
        return validateLocalPhotoFilename(requireString(value, field));
    } catch (error) {
        throw new Error(`${field}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

function parseBlockPhotos(value: unknown, field: string): string[] {
    if (!Array.isArray(value) || value.length === 0) throw new Error(`${field} must be a non-empty array`);
    return value.map((filename, index) => parseBlockPhoto(filename, `${field}[${index}]`));
}

/** Undefined optional fields are dropped so serialized blocks stay minimal. */
function compact<T extends AlbumBlock>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

const MEDIA_BLOCK_FIELDS = ["type", "caption", "captionPosition", "blockMargin", "photos"];

function parseBlock(value: unknown, index: number): AlbumBlock {
    const field = `block ${index}`;
    const block = requireRecord(value, field);
    const media = {
        caption: optionalString(block.caption, `${field} caption`),
        captionPosition: optionalString(block.captionPosition, `${field} captionPosition`),
        blockMargin: optionalString(block.blockMargin, `${field} blockMargin`),
    };
    switch (block.type) {
        case "Text":
            rejectUnknownFields(block, ["type", "align", "size", "blockMargin", "text"], field);
            return compact<TextBlock>({
                type: "Text",
                align: optionalEnum(block.align, ["left", "center", "right"] as const, `${field} align`),
                size: optionalEnum(block.size, ["caption", "title"] as const, `${field} size`),
                blockMargin: media.blockMargin,
                text: requireString(block.text, `${field} text`),
            });
        case "Row": {
            rejectUnknownFields(block, MEDIA_BLOCK_FIELDS, field);
            if (!Array.isArray(block.photos) || block.photos.length === 0) {
                throw new Error(`${field} photos must be a non-empty array`);
            }
            const photos = block.photos.map((item, itemIndex) => {
                const itemField = `${field} photos[${itemIndex}]`;
                if (typeof item === "string") return parseBlockPhoto(item, itemField);
                const column = requireRecord(item, itemField);
                rejectUnknownFields(column, ["column"], itemField);
                const members = parseBlockPhotos(column.column, `${itemField} column`);
                if (members.length < 2) throw new Error(`${itemField} column must hold at least two photos`);
                return { column: members };
            });
            return compact<RowBlock>({ type: "Row", ...media, photos });
        }
        case "PhotoCarousel":
            rejectUnknownFields(block, [...MEDIA_BLOCK_FIELDS, "initialSlide", "peekPercent"], field);
            return compact<PhotoCarouselBlock>({
                type: "PhotoCarousel",
                ...media,
                initialSlide: optionalIntegerInRange(block.initialSlide, `${field} initialSlide`, 0, Number.MAX_SAFE_INTEGER),
                peekPercent: optionalIntegerInRange(block.peekPercent, `${field} peekPercent`, 0, 90),
                photos: parseBlockPhotos(block.photos, `${field} photos`),
            });
        case "PhotoPanorama":
            rejectUnknownFields(block, [...MEDIA_BLOCK_FIELDS, "initialSlide", "initialView", "panoramaSlices"], field);
            return compact<PhotoPanoramaBlock>({
                type: "PhotoPanorama",
                ...media,
                initialSlide: optionalIntegerInRange(block.initialSlide, `${field} initialSlide`, 0, Number.MAX_SAFE_INTEGER),
                initialView: optionalEnum(block.initialView, ["carousel", "panorama"] as const, `${field} initialView`),
                panoramaSlices: optionalIntegerInRange(block.panoramaSlices, `${field} panoramaSlices`, 1, 24),
                photos: parseBlockPhotos(block.photos, `${field} photos`),
            });
        default:
            throw new Error(`${field} has an unsupported type`);
    }
}

export function parseAlbumManifest(input: unknown, albumSlug: string): AlbumManifest {
    validateAlbumSlug(albumSlug);
    const manifest = requireRecord(input, "album manifest");
    rejectUnknownFields(
        manifest,
        ["schemaVersion", "title", "info", "publishedAt", "order", "gap", "cover", "blocks", "photos"],
        "album manifest",
    );

    if (manifest.schemaVersion !== 2) {
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
    rejectUnknownFields(coverInput, ["photo", "zoom", "offset"], "cover");
    const coverPhoto = parseCoverPhoto(coverInput.photo);
    const zoom = requireFiniteNumber(coverInput.zoom, "cover zoom");
    if (zoom <= 0) throw new Error("cover zoom must be positive");
    const offsetInput = requireRecord(coverInput.offset, "cover offset");
    rejectUnknownFields(offsetInput, ["x", "y"], "cover offset");
    const offset = {
        x: requireCoordinate(offsetInput.x, "cover offset x"),
        y: requireCoordinate(offsetInput.y, "cover offset y"),
    };

    if (!Array.isArray(manifest.blocks)) throw new Error("blocks must be an array");
    const blocks = manifest.blocks.map(parseBlock);

    if (!Array.isArray(manifest.photos)) throw new Error("photos must be an array");
    const filenames = new Set<string>();
    const photos = manifest.photos.map((value, photoIndex) => {
        const photo = requireRecord(value, `photo ${photoIndex}`);
        rejectUnknownFields(
            photo,
            ["filename", "width", "height", "color", "caption", "tags"],
            `photo ${photoIndex}`,
        );
        const filename = validateLocalPhotoFilename(
            requireString(photo.filename, `photo ${photoIndex} filename`),
        );
        if (filenames.has(filename)) throw new Error(`Duplicate photo filename: ${filename}`);
        filenames.add(filename);

        const tagValues = photo.tags === undefined ? [] : photo.tags;
        if (!Array.isArray(tagValues)) throw new Error(`photo ${photoIndex} tags must be an array`);
        const width = optionalPositiveInteger(photo.width, `photo ${photoIndex} width`);
        const height = optionalPositiveInteger(photo.height, `photo ${photoIndex} height`);
        if ((width === undefined) !== (height === undefined)) {
            throw new Error(`photo ${photoIndex} width and height must be provided together`);
        }
        const color = optionalHexColor(photo.color, `photo ${photoIndex} color`);
        return {
            filename,
            ...(width !== undefined && height !== undefined ? { width, height } : {}),
            ...(color !== undefined ? { color } : {}),
            caption: optionalString(photo.caption, `photo ${photoIndex} caption`),
            tags: tagValues.map((tag, tagIndex) => parseTag(tag, tagIndex)),
        };
    });

    if (coverPhoto.kind === "local" && !filenames.has(coverPhoto.filename)) {
        throw new Error("Local cover filename must be present in photos");
    }

    return {
        schemaVersion: 2,
        title,
        info: optionalString(manifest.info, "info"),
        publishedAt,
        order,
        gap: optionalString(manifest.gap, "gap"),
        cover: { photo: coverPhoto, zoom, offset },
        blocks,
        photos,
    };
}
