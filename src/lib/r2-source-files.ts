import fs from 'node:fs';
import path from 'node:path';

import {
    buildR2SourceIndex,
    collectAlbumReferences,
    collectMountainReferences,
    type R2SourceIndex,
    type R2SourceReference,
} from './r2-source-index';

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
    const albumsRoot = path.join(projectRoot, 'src/content/albums');
    for (const filename of walkFiles(albumsRoot, '.mdx')) {
        const albumSlug = path.relative(albumsRoot, filename).replace(/\.mdx$/, '').split(path.sep).join('/');
        references.push(...collectAlbumReferences(albumSlug, fs.readFileSync(filename, 'utf8')));
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
