import test from 'node:test';
import assert from 'node:assert/strict';

import { applyAlbumCoverConfig } from './album-frontmatter.js';

test('applyAlbumCoverConfig replaces cover settings inside existing frontmatter', () => {
    const source = `---
title: "Test Album"
info: "Info"
coverKey: "old.jpg"
coverZoom: 1
coverOffset: { x: 50, y: 50 }
---

Body`;

    const next = applyAlbumCoverConfig(source, {
        coverKey: 'new.jpg',
        coverZoom: 1.2,
        coverOffset: { x: 42, y: 60 },
    });

    assert.match(next, /coverKey: "new.jpg"/);
    assert.match(next, /coverZoom: 1.2/);
    assert.match(next, /coverOffset: \{ x: 42, y: 60 \}/);
    assert.ok(!next.includes('coverKey: "old.jpg"'));
});

test('applyAlbumCoverConfig inserts missing cover settings without changing body', () => {
    const source = `---
title: "Test Album"
---

<Row>
  <Photo itemKey="001.jpg" />
</Row>`;

    const next = applyAlbumCoverConfig(source, {
        coverKey: '001.jpg',
        coverZoom: 1,
        coverOffset: { x: 50, y: 40 },
    });

    assert.match(next, /coverKey: "001.jpg"/);
    assert.match(next, /coverZoom: 1/);
    assert.match(next, /coverOffset: \{ x: 50, y: 40 \}/);
    assert.match(next, /<Photo itemKey="001.jpg" \/>/);
});