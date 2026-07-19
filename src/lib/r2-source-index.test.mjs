import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildR2SourceIndex,
    classifyRemoteObjects,
    collectAlbumReferences,
    collectMountainReferences,
} from './r2-source-index.ts';

test('album references resolve relative keys and keep legacy full keys', () => {
    const source = `---
title: "Album"
coverKey: "cover.jpg"
---
<Row>
  <Photo itemKey="001.jpg" />
  <Photo itemKey="shared/other/002.jpg" />
</Row>`;
    assert.deepEqual(
        collectAlbumReferences('yama/album', source).map((entry) => [entry.kind, entry.key]),
        [
            ['album-cover', 'yama/album/cover.jpg'],
            ['album-photo', 'yama/album/001.jpg'],
            ['album-photo', 'shared/other/002.jpg'],
        ],
    );
});

test('global index protects photos used by mountain covers', () => {
    const refs = [
        ...collectAlbumReferences('yama/album', `---\ntitle: "A"\ncoverKey: "001.jpg"\n---\n`),
        ...collectMountainReferences('src/mountains/taiwan.json', [
            { name: 'Mountain', coverKey: 'yama/album/001.jpg' },
        ]),
    ];
    const index = buildR2SourceIndex(refs);
    assert.equal(index.get('yama/album/001.jpg')?.length, 2);
    assert.equal(index.get('yama/album/001.jpg')?.[1].label, 'Mountain');
});

test('remote audit separates directory markers from deletable orphans', () => {
    const index = buildR2SourceIndex([{
        key: 'yama/album/used.jpg',
        kind: 'album-photo',
        source: 'src/content/albums/yama/album.mdx',
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
