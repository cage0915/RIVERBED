import { parseAlbumManifest } from './albums/manifest-schema.ts';
import { validateAlbumInventory } from './albums/validation.ts';

const ALBUM_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

export function validateAlbumSegment(value: unknown, label = 'Album slug') {
    const segment = String(value || '').trim();
    if (!ALBUM_SEGMENT_PATTERN.test(segment)) {
        throw new Error(`${label} must contain only lowercase letters, numbers, and single hyphens`);
    }
    return segment;
}

export function validateImageFilename(value: unknown) {
    const filename = String(value || '').trim();
    if (!filename || filename === '.' || filename === '..' || filename.includes('/') || filename.includes('\\')) {
        throw new Error(`Invalid image filename: ${filename || '(empty)'}`);
    }
    const dot = filename.lastIndexOf('.');
    const extension = dot >= 0 ? filename.slice(dot).toLowerCase() : '';
    if (!IMAGE_EXTENSIONS.has(extension)) {
        throw new Error(`Unsupported image type: ${filename}`);
    }
    return filename;
}


type AlbumImportOptions = {
    albumSlug: string;
    title: string;
    filenames: string[];
    photoDimensions?: Record<string, { width: number; height: number }>;
    publishedAt?: string;
    order: number;
};

/** Build and validate the manifest created for a new Album: one Row per photo. */
export function createAlbumImport({
    albumSlug,
    title,
    filenames,
    photoDimensions = {},
    publishedAt,
    order,
}: AlbumImportOptions) {
    const date = publishedAt || new Date().toISOString().slice(0, 10);
    const photos = filenames.map(validateImageFilename);
    if (photos.length === 0) throw new Error('Select at least one photo');
    if (new Set(photos).size !== photos.length) throw new Error('Duplicate photo filenames are not allowed');
    const manifest = parseAlbumManifest({
        schemaVersion: 2,
        title: String(title || '').trim(),
        publishedAt: date,
        order,
        cover: {
            photo: { kind: 'local', filename: photos[0] },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        blocks: photos.map((filename) => ({ type: 'Row', photos: [filename] })),
        photos: photos.map((filename) => ({
            filename,
            ...(photoDimensions[filename] || {}),
            tags: [],
        })),
    }, albumSlug);
    const diagnostics = validateAlbumInventory({
        albumSlug,
        manifestPath: `src/albums/${albumSlug}.json`,
        manifest,
    });
    if (diagnostics.length > 0) {
        throw new Error(`Invalid Album import proposal: ${diagnostics.map(({ code }) => code).join(', ')}`);
    }
    return { manifest };
}
