import assert from 'node:assert/strict';
import test from 'node:test';

import {
    createAlbumImport,
    validateAlbumSegment,
    validateImageFilename,
} from './album-import.js';

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

test('createAlbumImport proposes matching MDX and manifest inventory', () => {
    const proposal = createAlbumImport({
        albumSlug: 'yama/new-album',
        title: 'New Album',
        filenames: ['002.jpg', '001.jpg'],
        publishedAt: '2026-07-19',
        order: 30,
    });

    assert.equal(proposal.manifest.title, 'New Album');
    assert.equal(proposal.manifest.publishedAt, '2026-07-19');
    assert.equal(proposal.manifest.order, 30);
    assert.deepEqual(proposal.manifest.cover.photo, { kind: 'local', filename: '002.jpg' });
    assert.deepEqual(proposal.manifest.photos, [
        { filename: '002.jpg', caption: undefined, tags: [] },
        { filename: '001.jpg', caption: undefined, tags: [] },
    ]);
    assert.match(proposal.mdx, /<Photo itemKey="002\.jpg" \/>/);
    assert.doesNotMatch(proposal.mdx, /^(?:title|publishedAt|coverKey|coverZoom|coverOffset):/m);
});

test('createAlbumImport validates both proposals before returning either', () => {
    assert.throws(() => createAlbumImport({
        albumSlug: 'yama/new-album',
        title: 'New Album',
        filenames: ['002.jpg'],
        publishedAt: '2026-02-30',
        order: 30,
    }), /publishedAt/);
});
