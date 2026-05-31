import test from 'node:test';
import assert from 'node:assert/strict';

import {
    addOrUpdateTag,
    deleteTag,
    normalizeTagMap,
    mergeMountainEntries,
} from './dev-tag-state.js';

test('addOrUpdateTag adds a new tag to a photo entry', () => {
    const next = addOrUpdateTag({}, 'cover.jpg', {
        name: '南湖大山',
        x: 12.345,
        y: 67.891,
    });

    assert.deepEqual(next, {
        'cover.jpg': [{ name: '南湖大山', x: 12.35, y: 67.89 }],
    });
});

test('addOrUpdateTag can replace an existing tag in place', () => {
    const next = addOrUpdateTag(
        {
            'cover.jpg': [{ name: '舊名字', x: 12.35, y: 67.89 }],
        },
        'cover.jpg',
        { name: '新名字', x: 12.35, y: 67.89 },
        { name: '舊名字', x: 12.35, y: 67.89 },
    );

    assert.deepEqual(next, {
        'cover.jpg': [{ name: '新名字', x: 12.35, y: 67.89 }],
    });
});

test('deleteTag removes the target tag and drops empty photo keys', () => {
    const next = deleteTag(
        {
            'cover.jpg': [{ name: '南湖大山', x: 12.35, y: 67.89 }],
        },
        'cover.jpg',
        { name: '南湖大山', x: 12.35, y: 67.89 },
    );

    assert.deepEqual(next, {});
});

test('normalizeTagMap rounds coordinates and removes empty entries', () => {
    const next = normalizeTagMap({
        'cover.jpg': [{ name: '南湖大山', x: 12.345, y: 67.891 }],
        'empty.jpg': [],
    });

    assert.deepEqual(next, {
        'cover.jpg': [{ name: '南湖大山', x: 12.35, y: 67.89 }],
    });
});

test('mergeMountainEntries adds missing names and keeps zh-Hant sorting', () => {
    const next = mergeMountainEntries(
        [
            { name: '北大武山', elevation: null, description: '' },
            { name: '雪山', elevation: null, description: '' },
        ],
        ['南湖大山', '雪山'],
    );

    assert.deepEqual(
        next.map((entry) => entry.name),
        ['北大武山', '南湖大山', '雪山'],
    );
});