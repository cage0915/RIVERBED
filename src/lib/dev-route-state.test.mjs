import assert from 'node:assert/strict';
import test from 'node:test';

import {
    isMountainTagIndex,
    isMountainTagPage,
} from './dev-route-state.js';

test('mountain tag index is not an album or tag detail page', () => {
    assert.equal(isMountainTagIndex('/yama/tags'), true);
    assert.equal(isMountainTagIndex('/yama/tags/'), true);
    assert.equal(isMountainTagPage('/yama/tags'), false);
});

test('mountain tag detail is distinct from a normal album route', () => {
    assert.equal(isMountainTagPage('/yama/tags/%E5%8D%97%E5%A4%A7'), true);
    assert.equal(isMountainTagIndex('/yama/tags/%E5%8D%97%E5%A4%A7'), false);
    assert.equal(isMountainTagIndex('/yama/2026-jiaminghu-2'), false);
    assert.equal(isMountainTagPage('/yama/2026-jiaminghu-2'), false);
});

test('legacy query URL is no longer classified as the static tag index', () => {
    assert.equal(isMountainTagIndex('/yama'), false);
    assert.equal(isMountainTagPage('/tags/%E5%8D%97%E5%A4%A7'), false);
});
