import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    buildR2SourceIndex,
    classifyRemoteObjects,
    collectAlbumReferences,
    collectMountainReferences,
} from './r2-source-index.ts';
import { loadR2SourceIndex } from './r2-source-files.ts';

const manifest = (overrides = {}) => ({
    schemaVersion: 2,
    title: 'Album',
    order: 10,
    cover: {
        photo: { kind: 'local', filename: 'cover.jpg' },
        zoom: 1,
        offset: { x: 50, y: 50 },
    },
    blocks: [{ type: 'Row', photos: ['001.jpg'] }],
    photos: [
        { filename: 'cover.jpg', tags: [] },
        { filename: '001.jpg', tags: [] },
    ],
    ...overrides,
});

test('album references come only from local manifest inventory and resolved cover', () => {
    assert.deepEqual(
        collectAlbumReferences('yama/album', manifest()).map((entry) => [entry.kind, entry.key]),
        [
            ['album-photo', 'yama/album/cover.jpg'],
            ['album-photo', 'yama/album/001.jpg'],
            ['album-cover', 'yama/album/cover.jpg'],
        ],
    );
});

test('external cover indexes its original key without inventing a consumer object', () => {
    const references = collectAlbumReferences('k/consumer', manifest({
        cover: {
            photo: { kind: 'external', assetKey: 'yama/source/shared.jpg' },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
    }));
    assert.deepEqual(references.map((entry) => [entry.kind, entry.key]), [
        ['album-photo', 'k/consumer/cover.jpg'],
        ['album-photo', 'k/consumer/001.jpg'],
        ['album-cover', 'yama/source/shared.jpg'],
    ]);
    assert.equal(references.some(({ key }) => key === 'k/consumer/shared.jpg'), false);
});

test('global index protects photos used by mountain covers', () => {
    const refs = [
        ...collectAlbumReferences('yama/album', manifest({
            cover: {
                photo: { kind: 'local', filename: '001.jpg' },
                zoom: 1,
                offset: { x: 50, y: 50 },
            },
        })),
        ...collectMountainReferences('src/mountains/taiwan.json', [
            { name: 'Mountain', coverKey: 'yama/album/001.jpg' },
        ]),
    ];
    const index = buildR2SourceIndex(refs);
    assert.equal(index.get('yama/album/001.jpg')?.length, 3);
    assert.equal(index.get('yama/album/001.jpg')?.[2].label, 'Mountain');
});

test('remote audit separates directory markers from deletable orphans', () => {
    const index = buildR2SourceIndex([{
        key: 'yama/album/used.jpg',
        kind: 'album-photo',
        source: 'src/albums/yama/album.json',
    }]);
    const result = classifyRemoteObjects([
        { key: 'yama/' },
        { key: 'yama/album/used.jpg' },
        { key: 'yama/album/old.jpg' },
        { key: '_trash/2026-07-19/yama/album/old.jpg' },
    ], index);

    assert.deepEqual(result.directoryMarkers.map((object) => object.key), ['yama/']);
    assert.deepEqual(result.orphans.map((object) => object.key), ['yama/album/old.jpg']);
    assert.deepEqual(result.trash.map((object) => object.key), ['_trash/2026-07-19/yama/album/old.jpg']);
});

test('filesystem source index reads local photos from manifest inventory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-r2-index-'));
    await mkdir(path.join(root, 'src/albums/yama'), { recursive: true });
    await writeFile(path.join(root, 'src/albums/yama/album.json'), JSON.stringify(manifest()), 'utf8');

    const index = loadR2SourceIndex(root);
    assert.equal(index.has('yama/album/cover.jpg'), true);
    assert.equal(index.has('yama/album/001.jpg'), true);
});

test('filesystem source index rejects an external cover that does not resolve to tracked inventory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-r2-unresolved-'));
    await mkdir(path.join(root, 'src/albums/k'), { recursive: true });
    await writeFile(path.join(root, 'src/albums/k/consumer.json'), JSON.stringify(manifest({
        cover: {
            photo: { kind: 'external', assetKey: 'yama/missing/shared.jpg' },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
    })), 'utf8');

    assert.throws(() => loadR2SourceIndex(root), /does not resolve/i);
});
