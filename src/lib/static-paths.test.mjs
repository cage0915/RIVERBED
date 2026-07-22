import assert from 'node:assert/strict';
import test from 'node:test';

import { albumPathParams, folderPathParams, tagPathParams } from './static-paths.ts';

test('folder path params include configured and content folders once', () => {
    assert.deepEqual(
        folderPathParams(['yama/one', 'yama/two', 'y/three'], ['palette', 'y']),
        [
            { params: { folder: 'palette' } },
            { params: { folder: 'y' } },
            { params: { folder: 'yama' } },
        ],
    );
});

test('album path params split every valid album slug', () => {
    assert.deepEqual(albumPathParams(['yama/one', 'y/two']), [
        { params: { folder: 'yama', album: 'one' } },
        { params: { folder: 'y', album: 'two' } },
    ]);
});

test('album path params reject malformed slugs', () => {
    assert.throws(() => albumPathParams(['missing-album']), /Invalid album slug/);
});

test('tag path params merge mountain and photo tag names once', () => {
    assert.deepEqual(tagPathParams(['玉山', '富士山'], ['玉山', '雪山']), [
        { params: { tag: '富士山' } },
        { params: { tag: '玉山' } },
        { params: { tag: '雪山' } },
    ]);
});
