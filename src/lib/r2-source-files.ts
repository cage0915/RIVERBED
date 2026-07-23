import fs from 'node:fs';
import path from 'node:path';

import {
    buildR2SourceIndex,
    collectAlbumReferences,
    collectMountainReferences,
    type R2SourceIndex,
    type R2SourceReference,
} from './r2-source-index.ts';
import { parseAlbumManifest } from './albums/manifest-schema.ts';
import type { AlbumManifest } from './albums/types.ts';

const walkFiles = (directory: string, extension: string): string[] => {
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const resolved = path.join(directory, entry.name);
        if (entry.isDirectory()) return walkFiles(resolved, extension);
        return entry.isFile() && entry.name.endsWith(extension) ? [resolved] : [];
    });
};

export function loadR2SourceIndex(projectRoot = process.cwd()): R2SourceIndex {
    const references: R2SourceReference[] = [];
    const albumsRoot = path.join(projectRoot, 'src/album-manifests');
    const manifests = new Map<string, AlbumManifest>();
    for (const filename of walkFiles(albumsRoot, '.json')) {
        const albumSlug = path.relative(albumsRoot, filename).replace(/\.json$/, '').split(path.sep).join('/');
        try {
            const manifest = parseAlbumManifest(JSON.parse(fs.readFileSync(filename, 'utf8')), albumSlug);
            manifests.set(albumSlug, manifest);
        } catch (error) {
            throw new Error(`Failed to read R2 references from ${filename}`, { cause: error });
        }
    }
    for (const [albumSlug, manifest] of manifests) {
        if (manifest.cover.photo.kind === 'external') {
            const [folder, album, filename] = manifest.cover.photo.assetKey.split('/');
            const source = manifests.get(`${folder}/${album}`);
            if (!source?.photos.some((photo) => photo.filename === filename)) {
                throw new Error(
                    `External cover ${manifest.cover.photo.assetKey} in ${albumSlug} does not resolve to tracked Album inventory`,
                );
            }
        }
        references.push(...collectAlbumReferences(albumSlug, manifest));
    }

    const mountainsRoot = path.join(projectRoot, 'src/mountains');
    for (const filename of walkFiles(mountainsRoot, '.json')) {
        try {
            const source = path.relative(projectRoot, filename).split(path.sep).join('/');
            references.push(...collectMountainReferences(source, JSON.parse(fs.readFileSync(filename, 'utf8'))));
        } catch (error) {
            throw new Error(`Failed to read R2 references from ${filename}`, { cause: error });
        }
    }
    return buildR2SourceIndex(references);
}
