import type { AlbumSlug } from "./types.ts";

const ALBUM_SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const LOCAL_PHOTO_EXTENSION = /\.(?:jpe?g|png|webp|avif)$/i;

export function validateAlbumSlug(value: string): AlbumSlug {
    const segments = value.split("/");
    if (segments.length !== 2 || !segments.every((segment) => ALBUM_SEGMENT.test(segment))) {
        throw new Error(`Invalid album slug: ${value}`);
    }
    return `${segments[0]}/${segments[1]}`;
}

export function validateLocalPhotoFilename(value: string): string {
    const extension = value.match(LOCAL_PHOTO_EXTENSION);
    const basename = extension ? value.slice(0, -extension[0].length) : "";
    if (
        !value ||
        value.includes("/") ||
        value.includes("\\") ||
        !extension ||
        !basename ||
        /^\.+$/.test(basename)
    ) {
        throw new Error(`Invalid local filename: ${value}`);
    }
    return value;
}

export function normalizeAssetKey(value: string): string {
    const normalized = value.replace(/^\/+/, "");
    const segments = normalized.split("/");
    try {
        if (
            segments.length !== 3 ||
            !ALBUM_SEGMENT.test(segments[0]) ||
            !ALBUM_SEGMENT.test(segments[1])
        ) {
            throw new Error("invalid structure");
        }
        validateLocalPhotoFilename(segments[2]);
    } catch {
        throw new Error(`Invalid asset key: ${value}`);
    }
    return normalized;
}
