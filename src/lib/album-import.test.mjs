import assert from 'node:assert/strict';
import test from 'node:test';

import { createAlbumMdx, validateAlbumSegment, validateImageFilename } from './album-import.js';

test('album path segments reject traversal and unsafe names', () => {
    assert.equal(validateAlbumSegment('2026-new-page'), '2026-new-page');
    for (const value of ['../page', 'Page', 'two words', '-leading', 'trailing-']) {
        assert.throws(() => validateAlbumSegment(value));
    }
});
test('image filenames are basenames with supported extensions', () => {
    assert.equal(validateImageFilename('KCS00001.JPG'), 'KCS00001.JPG');
    assert.throws(() => validateImageFilename('../photo.jpg'));
    assert.throws(() => validateImageFilename('notes.txt'));
});

test('createAlbumMdx uses the first selected photo as cover and preserves order', () => {
    const source = createAlbumMdx({
        title: 'New Album',
        filenames: ['002.jpg', '001.jpg'],
        publishedAt: '2026-07-19',
    });
    assert.match(source, /coverKey: "002\.jpg"/);
    assert.ok(source.indexOf('002.jpg') < source.indexOf('001.jpg'));
    assert.match(source, /publishedAt: 2026-07-19/);
});
