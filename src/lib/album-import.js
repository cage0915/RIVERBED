const ALBUM_SEGMENT_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

import { parseAlbumManifest } from './albums/manifest-schema.ts';
import { validateAlbumInventory } from './albums/validation.ts';

export function validateAlbumSegment(value, label = 'Album slug') {
    const segment = String(value || '').trim();
    if (!ALBUM_SEGMENT_PATTERN.test(segment)) {
        throw new Error(`${label} must contain only lowercase letters, numbers, and single hyphens`);
    }
    return segment;
}

export function validateImageFilename(value) {
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

/**
 * @param {{ title: string, filenames: string[], publishedAt?: string }} options
 */
export function createAlbumMdx({ title, filenames, publishedAt }) {
    const safeTitle = String(title || '').trim();
    if (!safeTitle) throw new Error('Album title is required');
    const photos = filenames.map(validateImageFilename);
    if (photos.length === 0) throw new Error('Select at least one photo');
    if (new Set(photos).size !== photos.length) throw new Error('Duplicate photo filenames are not allowed');

    const date = publishedAt || new Date().toISOString().slice(0, 10);
    const escapedTitle = safeTitle.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    const rows = photos.map((filename) => `<Row>\n  <Photo itemKey="${filename}" />\n</Row>`);
    return `---\ntitle: "${escapedTitle}"\npublishedAt: ${date}\ncoverKey: "${photos[0]}"\ncoverZoom: 1\ncoverOffset: { x: 50, y: 50 }\n---\n\n${rows.join('\n\n')}\n`;
}

function createAlbumLayoutMdx(filenames) {
    const photos = filenames.map(validateImageFilename);
    if (photos.length === 0) throw new Error('Select at least one photo');
    if (new Set(photos).size !== photos.length) throw new Error('Duplicate photo filenames are not allowed');
    const rows = photos.map((filename) => `<Row>\n  <Photo itemKey="${filename}" />\n</Row>`);
    return `---\n---\n\n${rows.join('\n\n')}\n`;
}

/**
 * Build and cross-validate the two source files created for a new Album.
 * @param {{ albumSlug: string, title: string, filenames: string[], publishedAt?: string, order: number }} options
 */
export function createAlbumImport({ albumSlug, title, filenames, publishedAt, order }) {
    const date = publishedAt || new Date().toISOString().slice(0, 10);
    const mdx = createAlbumLayoutMdx(filenames);
    const photos = filenames.map(validateImageFilename);
    const manifest = parseAlbumManifest({
        schemaVersion: 1,
        title: String(title || '').trim(),
        publishedAt: date,
        order,
        cover: {
            photo: { kind: 'local', filename: photos[0] },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        photos: photos.map((filename) => ({ filename, tags: [] })),
    }, albumSlug);
    const diagnostics = validateAlbumInventory({
        albumSlug,
        manifestPath: `src/album-manifests/${albumSlug}.json`,
        manifest,
        mdxPath: `src/content/albums/${albumSlug}.mdx`,
        mdxBody: mdx,
    });
    if (diagnostics.length > 0) {
        throw new Error(`Invalid Album import proposal: ${diagnostics.map(({ code }) => code).join(', ')}`);
    }
    return { mdx, manifest };
}
