import assert from 'node:assert/strict';
import test from 'node:test';

import { createPageContent, referencedLocalNames } from './page-structure.ts';

test('page content preserves unrelated frontmatter while applying the draft', () => {
    const original = `---\ntitle: "Old"\npublishedAt: 2024-01-02\ncustom: keep\n---\n\n<Row>\n  <Photo itemKey="old.jpg" />\n</Row>\n`;
    const content = createPageContent(original, [
        { type: 'Row', props: {}, photos: [{ itemKey: 'new.jpg' }] },
    ], `title: "New"\npublishedAt: 2024-01-02\ncustom: keep`);

    assert.match(content, /publishedAt: 2024-01-02/);
    assert.match(content, /custom: keep/);
    assert.match(content, /<Photo itemKey="new\.jpg" \/>/);
    assert.doesNotMatch(content, /old\.jpg/);
});

test('referenced local names include page photos and cover basenames', () => {
    const names = referencedLocalNames([
        { type: 'Row', photos: [{ itemKey: 'one.jpg' }, { itemKey: 'yama/page/two.jpg' }] },
    ], `title: "Page"\ncoverKey: "yama/page/cover.jpg"`);

    assert.deepEqual([...names], ['one.jpg', 'two.jpg', 'cover.jpg']);
});
