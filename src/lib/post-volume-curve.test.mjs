import assert from 'node:assert/strict';
import test from 'node:test';

import { postVolumeCurve } from './post-volume-curve.ts';

test('returns null without posts', () => {
    assert.equal(postVolumeCurve([], 10), null);
});

test('draws a single post as a flat line on the shared scale', () => {
    // sqrt(25 / 100) = 0.5 of the height, so y = 50.
    assert.equal(postVolumeCurve([25], 100).line, 'M0,50L100,50');
});

test('spans the full width with oldest post on the left', () => {
    const { line, area } = postVolumeCurve([100, 0, 25], 100);
    assert.match(line, /^M0,0C/);
    assert.match(line, /100,50$/);
    assert.equal(area, `${line}L100,100L0,100Z`);
});

test('never overshoots the data range', () => {
    const { line } = postVolumeCurve([5, 112, 9, 60, 60, 13], 112);
    const ys = [...line.matchAll(/-?[\d.]+,(-?[\d.]+)/g)].map((match) => Number(match[1]));
    for (const y of ys) {
        assert.ok(y >= 0 && y <= 100, `control point y=${y} outside the box`);
    }
});
