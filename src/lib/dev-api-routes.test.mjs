import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import devApiRoutes, { DEV_API_ROUTES } from '../integrations/dev-api-routes.mjs';

const expectedNames = [
    'delete-album-page',
    'edit-caption',
    'edit-tag',
    'get-data',
    'get-folder-structure',
    'get-page-structure',
    'get-r2-cover-assets',
    'import-album-photos',
    'mountain-contexts',
    'mountain-contour-preview',
    'mountain-cover',
    'mountain-lookup',
    'mountain-regions',
    'mountains',
    'r2-album-plan',
    'r2-global-plan',
    'r2-sync-album',
    'r2-trash-objects',
    'rename-photos',
    'save-album-cover',
    'save-folder-order',
    'save-page-manager',
    'save-tags',
];

test('development API mapping explicitly covers every editor route', () => {
    assert.deepEqual(Object.keys(DEV_API_ROUTES).sort(), expectedNames);
    for (const [name, entrypoint] of Object.entries(DEV_API_ROUTES)) {
        assert.equal(entrypoint, `./src/dev-api/${name}.ts`);
    }
});

test('development API middleware is installed only for the dev command', () => {
    const integration = devApiRoutes();
    const setup = integration.hooks['astro:config:setup'];

    for (const command of ['build', 'preview', 'sync']) {
        const updates = [];
        setup({ command, updateConfig: (config) => updates.push(config) });
        assert.deepEqual(updates, []);
    }

    const updates = [];
    setup({ command: 'dev', updateConfig: (config) => updates.push(config) });
    assert.equal(updates.length, 1);
    assert.equal(updates[0].vite.plugins[0].name, 'riverbed-dev-api-middleware');
});

test('local R2 tools do not depend on Workers runtime bindings', () => {
    const projectFile = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
    const r2Client = projectFile('src/lib/r2-admin-client.ts');

    assert.doesNotMatch(r2Client, /R2Bucket|WorkerR2|createWorkerClient/);
    for (const name of expectedNames.filter((name) => name.startsWith('r2-'))) {
        assert.doesNotMatch(projectFile(`src/dev-api/${name}.ts`), /locals\.runtime/);
    }
});
