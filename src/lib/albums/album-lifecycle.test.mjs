import assert from 'node:assert/strict';
import { access, link as fsLink, mkdir, mkdtemp, readFile, readdir, rename as fsRename, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
    AlbumAssetConflictError,
    AlbumLifecycleConflictError,
    AlbumSourceRollbackIncompleteError,
    albumPageManagerMetadata,
    buildPhotoRenameProposal,
    buildAlbumPageProposal,
    assertAlbumAssetStorageSafe,
    assertUniqueR2ActionKeys,
    commitAlbumAssets,
    commitAlbumAssetsWithinLock,
    commitAlbumImportSources,
    commitAlbumPageSourcesWithinLock,
    deleteAlbumSourceFiles,
    executeAlbumPhotoRename,
    findAlbumDeletionConsumers,
    findExternalCoverConsumers,
    replaceSourceFilesAtomically,
    withR2SourceAlbumLocks,
} from './album-lifecycle.ts';
import { createAlbumImport } from '../album-import.js';
import { createLayoutOnlyPageContent } from '../page-structure.ts';
import { readAlbumManifestFile, updateAlbumCover, withAlbumManifestLocks } from './manifest-files.ts';

const album = (overrides = {}) => ({
    schemaVersion: 1,
    title: 'Source',
    order: 10,
    cover: {
        photo: { kind: 'local', filename: 'A.jpg' },
        zoom: 1,
        offset: { x: 50, y: 50 },
    },
    photos: [
        { filename: 'A.jpg', caption: 'A', tags: [] },
        { filename: 'B.jpg', tags: [{ name: 'Peak', x: 10, y: 20 }] },
    ],
    ...overrides,
});

test('rename proposal updates source inventory, MDX, local cover, and every external cover', () => {
    const manifests = {
        'yama/source': album(),
        'k/z-consumer': album({
            title: 'Z',
            cover: {
                photo: { kind: 'external', assetKey: 'yama/source/A.jpg' },
                zoom: 1.5,
                offset: { x: 10, y: 90 },
            },
        }),
        'k/a-consumer': album({
            title: 'A',
            cover: {
                photo: { kind: 'external', assetKey: 'yama/source/B.jpg' },
                zoom: 2,
                offset: { x: 20, y: 80 },
            },
        }),
    };
    const mdx = '<Row>\n  <Photo itemKey="A.jpg" />\n  <Photo itemKey="B.jpg" />\n</Row>\n';

    const proposal = buildPhotoRenameProposal({
        albumSlug: 'yama/source',
        mdx,
        manifests,
        renameMap: new Map([['A.jpg', '001.jpg'], ['B.jpg', '002.jpg']]),
    });

    assert.deepEqual(proposal.manifests['yama/source'].photos.map(({ filename }) => filename), ['001.jpg', '002.jpg']);
    assert.deepEqual(proposal.manifests['yama/source'].cover.photo, { kind: 'local', filename: '001.jpg' });
    assert.match(proposal.mdx, /itemKey="001\.jpg"/);
    assert.match(proposal.mdx, /itemKey="002\.jpg"/);
    assert.equal(proposal.manifests['k/z-consumer'].cover.photo.assetKey, 'yama/source/001.jpg');
    assert.equal(proposal.manifests['k/a-consumer'].cover.photo.assetKey, 'yama/source/002.jpg');
});

test('rename proposal rejects cross-Album MDX content before any file operation', () => {
    assert.throws(() => buildPhotoRenameProposal({
        albumSlug: 'yama/source',
        mdx: '<Photo itemKey="k/other/A.jpg" />',
        manifests: { 'yama/source': album() },
        renameMap: new Map([['A.jpg', '001.jpg']]),
    }), /static local filename|Invalid local filename|MDX/i);
});

test('rename changes only extracted Photo nodes and leaves code examples byte-for-byte intact', () => {
    const mdx = '```mdx\n<Photo itemKey="A.jpg" />\n```\n\n<Photo itemKey="A.jpg" />\n';
    const proposal = buildPhotoRenameProposal({
        albumSlug: 'yama/source',
        mdx,
        manifests: {
            'yama/source': album({ photos: [{ filename: 'A.jpg', tags: [] }] }),
        },
        renameMap: new Map([['A.jpg', '001.jpg']]),
    });
    assert.equal(proposal.mdx, '```mdx\n<Photo itemKey="A.jpg" />\n```\n\n<Photo itemKey="001.jpg" />\n');
});

test('external cover conflict consumers are exact, unique, and sorted', () => {
    const manifests = {
        'yama/source': album(),
        'k/z': album({ cover: { photo: { kind: 'external', assetKey: 'yama/source/A.jpg' }, zoom: 1, offset: { x: 50, y: 50 } } }),
        'k/a': album({ cover: { photo: { kind: 'external', assetKey: 'yama/source/A.jpg' }, zoom: 1, offset: { x: 50, y: 50 } } }),
        'k/unrelated': album(),
    };
    assert.deepEqual(findExternalCoverConsumers(manifests, 'yama/source/A.jpg'), ['k/a', 'k/z']);
    assert.deepEqual(findAlbumDeletionConsumers(manifests, 'yama/source'), ['k/a', 'k/z']);
    const error = new AlbumLifecycleConflictError('yama/source/A.jpg', ['k/z', 'k/a', 'k/a']);
    assert.equal(error.code, 'external-cover-conflict');
    assert.deepEqual(error.consumerSlugs, ['k/a', 'k/z']);
});

test('R2 source lock prevents a concurrent external-cover selection from passing the trash snapshot', async () => {
    const project = await lifecycleProject();
    await writeFile(project.consumerManifest, JSON.stringify(album({ title: 'Consumer' })), 'utf8');
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let entered;
    const didEnter = new Promise((resolve) => { entered = resolve; });
    const trashOperation = withR2SourceAlbumLocks(project.root, ['yama/source/A.jpg'], async () => {
        entered();
        await held;
    });
    await didEnter;
    let coverFinished = false;
    const coverMutation = updateAlbumCover(project.root, 'k/consumer', {
        assetKey: 'yama/source/A.jpg', zoom: 1, offset: { x: 50, y: 50 },
    }).then(() => { coverFinished = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(coverFinished, false);
    release();
    await Promise.all([trashOperation, coverMutation]);
    assert.equal(coverFinished, true);
});

test('R2 action preflight rejects duplicate keys regardless of action pairing', () => {
    assert.throws(() => assertUniqueR2ActionKeys([
        'yama/source/A.jpg',
        'yama/source/A.jpg',
    ]), /Duplicate R2 action key/);
    assert.doesNotThrow(() => assertUniqueR2ActionKeys([
        'yama/source/A.jpg',
        'yama/source/B.jpg',
    ]));
});

test('shared Album asset storage guard rejects an R2 directory symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-asset-guard-'));
    const external = await mkdtemp(path.join(tmpdir(), 'riverbed-asset-guard-external-'));
    await mkdir(path.join(root, 'r2/yama'), { recursive: true });
    await symlink(external, path.join(root, 'r2/yama/source'));
    await assert.rejects(assertAlbumAssetStorageSafe(root, 'yama/source'), /symlink/i);
});

test('shared Album asset storage guard rejects a photo symlink inside a normal directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-photo-guard-'));
    const external = path.join(await mkdtemp(path.join(tmpdir(), 'riverbed-photo-external-')), 'secret.jpg');
    await writeFile(external, 'secret', 'utf8');
    await mkdir(path.join(root, 'r2/yama/source'), { recursive: true });
    await symlink(external, path.join(root, 'r2/yama/source/A.jpg'));
    await assert.rejects(assertAlbumAssetStorageSafe(root, 'yama/source'), /symlink/i);
});

async function lifecycleProject() {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-lifecycle-'));
    const sourceManifest = path.join(root, 'src/album-manifests/yama/source.json');
    const consumerManifest = path.join(root, 'src/album-manifests/k/consumer.json');
    const mdx = path.join(root, 'src/content/albums/yama/source.mdx');
    const r2 = path.join(root, 'r2/yama/source');
    await Promise.all([
        mkdir(path.dirname(sourceManifest), { recursive: true }),
        mkdir(path.dirname(consumerManifest), { recursive: true }),
        mkdir(path.dirname(mdx), { recursive: true }),
        mkdir(r2, { recursive: true }),
    ]);
    await writeFile(sourceManifest, JSON.stringify(album()), 'utf8');
    await writeFile(consumerManifest, JSON.stringify(album({
        title: 'Consumer',
        cover: {
            photo: { kind: 'external', assetKey: 'yama/source/A.jpg' },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
    })), 'utf8');
    await writeFile(mdx, '<Row>\n  <Photo itemKey="A.jpg" />\n  <Photo itemKey="B.jpg" />\n</Row>\n', 'utf8');
    await writeFile(path.join(r2, 'A.jpg'), 'a', 'utf8');
    await writeFile(path.join(r2, 'B.jpg'), 'b', 'utf8');
    return { root, sourceManifest, consumerManifest, mdx, r2 };
}

test('asset-only import serializes behind Page Manager and conflicts on different bytes', async () => {
    const project = await lifecycleProject();
    const filename = 'X.jpg';
    const target = path.join(project.r2, filename);
    await assert.rejects(access(target), /ENOENT/); // Page Manager preflight snapshot.

    let releasePageManager;
    const pageManagerHeld = new Promise((resolve) => { releasePageManager = resolve; });
    let pageManagerEntered;
    const pageManagerDidEnter = new Promise((resolve) => { pageManagerEntered = resolve; });
    const pageManager = withAlbumManifestLocks(project.root, ['yama/source'], async () => {
        pageManagerEntered();
        await pageManagerHeld;
        await writeFile(target, 'page-manager', { flag: 'wx' });
    });
    await pageManagerDidEnter;

    let importSettled = false;
    const assetImport = commitAlbumAssets(project.root, 'yama/source', [{
        name: filename,
        bytes: new TextEncoder().encode('asset-import'),
    }]).finally(() => { importSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(importSettled, false, 'asset import must wait for the target Album lock');

    releasePageManager();
    await pageManager;
    await assert.rejects(assetImport, (error) => {
        assert.ok(error instanceof AlbumAssetConflictError);
        assert.deepEqual(error.filenames, [filename]);
        return true;
    });
    assert.equal(await readFile(target, 'utf8'), 'page-manager');
});

test('Page Manager rechecks assets after a queued asset-only import and leaves its manifest unchanged on conflict', async () => {
    const project = await lifecycleProject();
    const filename = 'X.jpg';
    const target = path.join(project.r2, filename);
    await assert.rejects(access(target), /ENOENT/); // Stale Page Manager preflight snapshot.
    const manifestBefore = await readFile(project.sourceManifest, 'utf8');

    let releaseAssetImport;
    const assetImportHeld = new Promise((resolve) => { releaseAssetImport = resolve; });
    let assetImportEntered;
    const assetImportDidEnter = new Promise((resolve) => { assetImportEntered = resolve; });
    const assetImport = withAlbumManifestLocks(project.root, ['yama/source'], async () => {
        assetImportEntered();
        await assetImportHeld;
        return commitAlbumAssetsWithinLock(project.root, 'yama/source', [{
            name: filename,
            bytes: new TextEncoder().encode('asset-import'),
        }]);
    });
    await assetImportDidEnter;

    let pageManagerSettled = false;
    const pageManager = withAlbumManifestLocks(project.root, ['yama/source'], async () => {
        await commitAlbumAssetsWithinLock(project.root, 'yama/source', [{
            name: filename,
            bytes: new TextEncoder().encode('page-manager'),
        }]);
        await writeFile(project.sourceManifest, JSON.stringify(album({ title: 'Wrong commit' })), 'utf8');
    }).finally(() => { pageManagerSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(pageManagerSettled, false, 'Page Manager must wait for the target Album lock');

    releaseAssetImport();
    assert.deepEqual(await assetImport, { copied: [filename], skipped: [] });
    await assert.rejects(pageManager, AlbumAssetConflictError);
    assert.equal(await readFile(target, 'utf8'), 'asset-import');
    assert.equal(await readFile(project.sourceManifest, 'utf8'), manifestBefore);
});

test('rename executes the R2 plan before atomically replacing every proposed source file', async () => {
    const project = await lifecycleProject();
    const result = await executeAlbumPhotoRename(project.root, 'yama/source', [
        'yama/source/A.jpg',
        'yama/source/B.jpg',
    ]);

    assert.deepEqual(result.renamed, { 'A.jpg': '001.jpg', 'B.jpg': '002.jpg' });
    assert.equal(await readFile(path.join(project.r2, '001.jpg'), 'utf8'), 'a');
    assert.equal(await readFile(path.join(project.r2, '002.jpg'), 'utf8'), 'b');
    assert.match(await readFile(project.mdx, 'utf8'), /itemKey="001\.jpg"/);
    assert.equal(JSON.parse(await readFile(project.consumerManifest, 'utf8')).cover.photo.assetKey, 'yama/source/001.jpg');
});

test('R2 failure leaves all tracked source files byte-for-byte unchanged', async () => {
    const project = await lifecycleProject();
    const before = await Promise.all([
        readFile(project.sourceManifest, 'utf8'),
        readFile(project.consumerManifest, 'utf8'),
        readFile(project.mdx, 'utf8'),
    ]);

    await assert.rejects(executeAlbumPhotoRename(project.root, 'yama/source', [
        'yama/source/A.jpg',
        'yama/source/B.jpg',
    ], {
        applyR2Plan: async () => { throw new Error('injected R2 failure'); },
    }), /injected R2 failure/);

    assert.deepEqual(await Promise.all([
        readFile(project.sourceManifest, 'utf8'),
        readFile(project.consumerManifest, 'utf8'),
        readFile(project.mdx, 'utf8'),
    ]), before);
});

test('source replacement failure compensates an already completed R2 rename', async () => {
    const project = await lifecycleProject();
    await assert.rejects(executeAlbumPhotoRename(project.root, 'yama/source', [
        'yama/source/A.jpg',
        'yama/source/B.jpg',
    ], {
        commitSourceFiles: async () => { throw new Error('injected source failure'); },
    }), /injected source failure/);

    assert.equal(await readFile(path.join(project.r2, 'A.jpg'), 'utf8'), 'a');
    assert.equal(await readFile(path.join(project.r2, 'B.jpg'), 'utf8'), 'b');
    await assert.rejects(access(path.join(project.r2, '001.jpg')), /ENOENT/);
});

test('source replacement rollback failure is typed and retains recovery artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-source-rollback-'));
    const first = path.join(root, 'src/a.json');
    const second = path.join(root, 'src/b.mdx');
    await mkdir(path.dirname(first), { recursive: true });
    await writeFile(first, 'old-a', 'utf8');
    await writeFile(second, 'old-b', 'utf8');
    let commitFailed = false;

    await assert.rejects(replaceSourceFilesAtomically([
        { target: first, content: 'new-a' },
        { target: second, content: 'new-b' },
    ], root, {
        rename: async (source, target) => {
            if (source.includes('.tmp') && target === second) {
                commitFailed = true;
                throw new Error('injected replace commit failure');
            }
            return fsRename(source, target);
        },
        unlink: async (target) => {
            if (commitFailed && target === first) throw new Error('injected replace rollback failure');
            return unlink(target);
        },
    }), (error) => {
        assert.ok(error instanceof AlbumSourceRollbackIncompleteError);
        assert.equal(error.outcome, 'unknown');
        assert.match(String(error.commitError), /replace commit failure/);
        assert.equal(error.rollbackErrors.length, 1);
        assert.ok(error.recoveryArtifacts.some((artifact) => artifact.endsWith('.bak')));
        return true;
    });
    assert.equal(await readFile(first, 'utf8'), 'new-a');
    assert.ok((await readdir(path.dirname(first))).some((name) => name.endsWith('.bak')));
});

test('source replacement with a clean rollback restores originals and removes artifacts', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-source-clean-rollback-'));
    const first = path.join(root, 'src/a.json');
    const second = path.join(root, 'src/b.mdx');
    await mkdir(path.dirname(first), { recursive: true });
    await writeFile(first, 'old-a', 'utf8');
    await writeFile(second, 'old-b', 'utf8');
    await assert.rejects(replaceSourceFilesAtomically([
        { target: first, content: 'new-a' },
        { target: second, content: 'new-b' },
    ], root, {
        rename: async (source, target) => {
            if (source.includes('.tmp') && target === second) throw new Error('clean commit failure');
            return fsRename(source, target);
        },
    }), /clean commit failure/);
    assert.deepEqual(await Promise.all([readFile(first, 'utf8'), readFile(second, 'utf8')]), ['old-a', 'old-b']);
    assert.deepEqual((await readdir(path.dirname(first))).sort(), ['a.json', 'b.mdx']);
});

test('rename does not compensate R2 when source rollback outcome is unknown', async () => {
    const project = await lifecycleProject();
    let compensated = false;
    let replacementCount = 0;
    let commitFailed = false;
    await assert.rejects(executeAlbumPhotoRename(project.root, 'yama/source', [
        'yama/source/A.jpg', 'yama/source/B.jpg',
    ], {
        applyR2Plan: async () => async () => { compensated = true; },
        commitSourceFiles: async (proposals) => replaceSourceFilesAtomically(
            proposals,
            project.root,
            {
                rename: async (source, target) => {
                    if (source.includes('.tmp')) {
                        replacementCount += 1;
                        if (replacementCount === 2) {
                            commitFailed = true;
                            throw new Error('injected rename source commit failure');
                        }
                    }
                    return fsRename(source, target);
                },
                unlink: async (target) => {
                    if (commitFailed && !target.includes('.tmp') && !target.includes('.bak')) {
                        throw new Error('injected rename source rollback failure');
                    }
                    return unlink(target);
                },
            },
        ),
    }), (error) => {
        assert.ok(error instanceof AlbumSourceRollbackIncompleteError);
        assert.equal(error.outcome, 'unknown');
        assert.ok(error.recoveryArtifacts.some((artifact) => artifact.endsWith('.bak')));
        return true;
    });
    assert.equal(compensated, false);
});

test('phase-two chained R2 rename failure restores every original byte without overwriting', async () => {
    const project = await lifecycleProject();
    await unlink(path.join(project.r2, 'B.jpg'));
    await writeFile(path.join(project.r2, '001.jpg'), 'one', 'utf8');
    await writeFile(path.join(project.r2, '002.jpg'), 'two', 'utf8');
    const source = album({
        photos: [
            { filename: 'A.jpg', tags: [] },
            { filename: '001.jpg', tags: [] },
            { filename: '002.jpg', tags: [] },
        ],
    });
    await writeFile(project.sourceManifest, JSON.stringify(source), 'utf8');
    await writeFile(project.mdx, '<Photo itemKey="A.jpg" />\n<Photo itemKey="001.jpg" />\n<Photo itemKey="002.jpg" />\n', 'utf8');

    await assert.rejects(executeAlbumPhotoRename(project.root, 'yama/source', [
        'yama/source/A.jpg', 'yama/source/001.jpg', 'yama/source/002.jpg',
    ], {
        renameR2Path: async (sourcePath, targetPath) => {
            if (sourcePath.includes('.__album_rename_') && targetPath.endsWith('/003.jpg')) {
                throw new Error('injected phase-two failure');
            }
            return fsRename(sourcePath, targetPath);
        },
    }), /injected phase-two failure/);

    assert.equal(await readFile(path.join(project.r2, 'A.jpg'), 'utf8'), 'a');
    assert.equal(await readFile(path.join(project.r2, '001.jpg'), 'utf8'), 'one');
    assert.equal(await readFile(path.join(project.r2, '002.jpg'), 'utf8'), 'two');
    assert.deepEqual((await readdir(project.r2)).sort(), ['001.jpg', '002.jpg', 'A.jpg']);
});

test('import commits slug-paired MDX and manifest together', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-import-source-'));
    await mkdir(path.join(root, 'src/album-manifests/yama'), { recursive: true });
    await writeFile(
        path.join(root, 'src/album-manifests/yama/existing.json'),
        JSON.stringify(album({ order: 10 })),
        'utf8',
    );
    const proposal = createAlbumImport({
        albumSlug: 'yama/new-album',
        title: 'New Album',
        filenames: ['A.jpg'],
        publishedAt: '2026-07-22',
        order: 20,
    });

    await commitAlbumImportSources(root, 'yama/new-album', proposal);

    assert.match(await readFile(path.join(root, 'src/content/albums/yama/new-album.mdx'), 'utf8'), /itemKey="A\.jpg"/);
    assert.equal(JSON.parse(await readFile(path.join(root, 'src/album-manifests/yama/new-album.json'), 'utf8')).order, 20);
});

test('imported Album metadata round-trips through Page Manager without returning to MDX', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-page-manager-boundary-'));
    await mkdir(path.join(root, 'src/album-manifests'), { recursive: true });
    const albumSlug = 'yama/page-manager';
    const proposal = createAlbumImport({
        albumSlug,
        title: 'Imported title',
        filenames: ['A.jpg'],
        publishedAt: '2026-07-22',
        order: 10,
    });
    proposal.manifest.info = 'Imported info';
    proposal.manifest.gap = '2rem';
    proposal.manifest.cover.zoom = 1.75;
    proposal.manifest.cover.offset = { x: 25, y: 80 };
    await commitAlbumImportSources(root, albumSlug, proposal);

    const importedManifest = await readAlbumManifestFile(root, albumSlug);
    assert.deepEqual(albumPageManagerMetadata(albumSlug, importedManifest), {
        title: 'Imported title',
        info: 'Imported info',
        gap: '2rem',
        cover: {
            assetKey: 'yama/page-manager/A.jpg',
            zoom: 1.75,
            offset: { x: 25, y: 80 },
        },
    });

    const mdx = createLayoutOnlyPageContent([{
        type: 'Row',
        photos: [{ itemKey: 'A.jpg' }],
    }]);
    const savedManifest = buildAlbumPageProposal({
        albumSlug,
        manifest: importedManifest,
        mdx,
        importedFilenames: [],
        metadata: { title: 'Edited title', info: 'Edited info', gap: '3rem' },
    });
    await replaceSourceFilesAtomically([
        { target: path.join(root, `src/content/albums/${albumSlug}.mdx`), content: mdx },
        {
            target: path.join(root, `src/album-manifests/${albumSlug}.json`),
            content: `${JSON.stringify(savedManifest, null, 2)}\n`,
        },
    ], root);

    const persisted = await readAlbumManifestFile(root, albumSlug);
    assert.equal(persisted.title, 'Edited title');
    assert.equal(persisted.info, 'Edited info');
    assert.equal(persisted.gap, '3rem');
    assert.deepEqual(persisted.cover, importedManifest.cover);
    assert.equal(
        await readFile(path.join(root, `src/content/albums/${albumSlug}.mdx`), 'utf8'),
        '---\n---\n\n<Row>\n  <Photo itemKey="A.jpg" />\n</Row>\n',
    );
});

test('invalid import proposal creates neither source file', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-invalid-import-'));
    await mkdir(path.join(root, 'src/album-manifests/yama'), { recursive: true });
    const proposal = createAlbumImport({
        albumSlug: 'yama/new-album',
        title: 'New Album',
        filenames: ['A.jpg'],
        publishedAt: '2026-07-22',
        order: 10,
    });
    proposal.manifest.title = '';

    await assert.rejects(commitAlbumImportSources(root, 'yama/new-album', proposal), /title/);
    await assert.rejects(access(path.join(root, 'src/content/albums/yama/new-album.mdx')), /ENOENT/);
    await assert.rejects(access(path.join(root, 'src/album-manifests/yama/new-album.json')), /ENOENT/);
});

test('concurrent imports serialize by folder and receive distinct next order values', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-concurrent-import-'));
    await mkdir(path.join(root, 'src/album-manifests'), { recursive: true });
    const first = createAlbumImport({
        albumSlug: 'yama/first', title: 'First', filenames: ['A.jpg'], order: 10,
    });
    const second = createAlbumImport({
        albumSlug: 'yama/second', title: 'Second', filenames: ['B.jpg'], order: 10,
    });

    await Promise.all([
        commitAlbumImportSources(root, 'yama/first', first),
        commitAlbumImportSources(root, 'yama/second', second),
    ]);

    const orders = await Promise.all(['first', 'second'].map(async (name) =>
        JSON.parse(await readFile(path.join(root, `src/album-manifests/yama/${name}.json`), 'utf8')).order
    ));
    assert.deepEqual([...orders].sort((a, b) => a - b), [10, 20]);
});

test('same-slug concurrent imports cannot remove or overwrite the winning request asset', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-same-import-'));
    await mkdir(path.join(root, 'src/album-manifests'), { recursive: true });
    const first = createAlbumImport({ albumSlug: 'yama/same', title: 'First', filenames: ['A.jpg'], order: 10 });
    const second = createAlbumImport({ albumSlug: 'yama/same', title: 'Second', filenames: ['A.jpg'], order: 10 });
    const results = await Promise.allSettled([
        commitAlbumImportSources(root, 'yama/same', first, [{ name: 'A.jpg', bytes: new TextEncoder().encode('first') }]),
        commitAlbumImportSources(root, 'yama/same', second, [{ name: 'A.jpg', bytes: new TextEncoder().encode('second') }]),
    ]);
    assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
    const manifest = JSON.parse(await readFile(path.join(root, 'src/album-manifests/yama/same.json'), 'utf8'));
    assert.equal(await readFile(path.join(root, 'r2/yama/same/A.jpg'), 'utf8'), manifest.title.toLowerCase());
});

test('Nth asset write failure removes earlier assets and creates neither paired source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-asset-failure-'));
    await mkdir(path.join(root, 'src/album-manifests'), { recursive: true });
    const proposal = createAlbumImport({
        albumSlug: 'yama/failure', title: 'Failure', filenames: ['A.jpg', 'B.jpg'], order: 10,
    });
    let writes = 0;
    await assert.rejects(commitAlbumImportSources(root, 'yama/failure', proposal, [
        { name: 'A.jpg', bytes: new Uint8Array([1]) },
        { name: 'B.jpg', bytes: new Uint8Array([2]) },
    ], {
        writeAsset: async (...args) => {
            writes += 1;
            if (writes === 2) throw new Error('injected asset write failure');
            return writeFile(...args);
        },
    }), /injected asset write failure/);
    for (const filename of [
        'r2/yama/failure/A.jpg',
        'r2/yama/failure/B.jpg',
        'src/content/albums/yama/failure.mdx',
        'src/album-manifests/yama/failure.json',
    ]) await assert.rejects(access(path.join(root, filename)), /ENOENT/);
});

test('import preserves copied assets when paired source creation rollback is incomplete', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-import-source-rollback-'));
    await mkdir(path.join(root, 'src/album-manifests'), { recursive: true });
    const albumSlug = 'yama/uncertain-import';
    const proposal = createAlbumImport({
        albumSlug, title: 'Uncertain', filenames: ['A.jpg'], order: 10,
    });
    await assert.rejects(commitAlbumImportSources(root, albumSlug, proposal, [{
        name: 'A.jpg', bytes: new TextEncoder().encode('asset'),
    }], {
        sourceFiles: {
            link: async (source, target) => {
                if (target.endsWith('.mdx')) throw new Error('injected create commit failure');
                return fsLink(source, target);
            },
            unlink: async (target) => {
                if (target.endsWith('.json')) throw new Error('injected create rollback failure');
                return unlink(target);
            },
        },
    }), (error) => {
        assert.ok(error instanceof AlbumSourceRollbackIncompleteError);
        assert.equal(error.operation, 'create');
        assert.equal(error.outcome, 'unknown');
        assert.ok(error.recoveryArtifacts.length > 0);
        return true;
    });
    assert.equal(await readFile(path.join(root, 'r2/yama/uncertain-import/A.jpg'), 'utf8'), 'asset');
    assert.ok((await readdir(path.join(root, 'src/album-manifests/yama'))).length > 0);
});

test('import removes copied assets after a clean paired-source creation rollback', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-import-clean-source-rollback-'));
    await mkdir(path.join(root, 'src/album-manifests'), { recursive: true });
    const albumSlug = 'yama/clean-import';
    const proposal = createAlbumImport({ albumSlug, title: 'Clean', filenames: ['A.jpg'], order: 10 });
    await assert.rejects(commitAlbumImportSources(root, albumSlug, proposal, [{
        name: 'A.jpg', bytes: new TextEncoder().encode('asset'),
    }], {
        sourceFiles: {
            link: async (source, target) => {
                if (target.endsWith('.mdx')) throw new Error('clean create failure');
                return fsLink(source, target);
            },
        },
    }), /clean create failure/);
    await assert.rejects(access(path.join(root, 'r2/yama/clean-import/A.jpg')), /ENOENT/);
    await assert.rejects(access(path.join(root, 'src/album-manifests/yama/clean-import.json')), /ENOENT/);
    await assert.rejects(access(path.join(root, 'src/content/albums/yama/clean-import.mdx')), /ENOENT/);
});

test('Page Manager preserves copied assets when source replacement rollback is incomplete', async () => {
    const project = await lifecycleProject();
    const newAsset = { name: 'X.jpg', bytes: new TextEncoder().encode('page-asset') };
    let commitFailed = false;
    await assert.rejects(commitAlbumPageSourcesWithinLock({
        projectRoot: project.root,
        albumSlug: 'yama/source',
        assets: [newAsset],
        sourceProposals: [
            { target: project.sourceManifest, content: JSON.stringify(album({ title: 'New source' })) },
            { target: project.mdx, content: '<Photo itemKey="X.jpg" />\n' },
        ],
        sourceOperations: {
            rename: async (source, target) => {
                if (source.includes('.tmp') && target === project.mdx) {
                    commitFailed = true;
                    throw new Error('injected Page Manager commit failure');
                }
                return fsRename(source, target);
            },
            unlink: async (target) => {
                if (commitFailed && target === project.sourceManifest) {
                    throw new Error('injected Page Manager rollback failure');
                }
                return unlink(target);
            },
        },
    }), (error) => {
        assert.ok(error instanceof AlbumSourceRollbackIncompleteError);
        assert.equal(error.operation, 'replace');
        assert.equal(error.outcome, 'unknown');
        assert.ok(error.recoveryArtifacts.some((artifact) => artifact.endsWith('.bak')));
        return true;
    });
    assert.equal(await readFile(path.join(project.r2, 'X.jpg'), 'utf8'), 'page-asset');
});

test('Page Manager removes copied assets after a clean source replacement rollback', async () => {
    const project = await lifecycleProject();
    const target = path.join(project.r2, 'X.jpg');
    await assert.rejects(commitAlbumPageSourcesWithinLock({
        projectRoot: project.root,
        albumSlug: 'yama/source',
        assets: [{ name: 'X.jpg', bytes: new TextEncoder().encode('page-asset') }],
        sourceProposals: [
            { target: project.sourceManifest, content: JSON.stringify(album({ title: 'New source' })) },
            { target: project.mdx, content: '<Photo itemKey="X.jpg" />\n' },
        ],
        sourceOperations: {
            rename: async (source, renameTarget) => {
                if (source.includes('.tmp') && renameTarget === project.mdx) throw new Error('clean Page Manager failure');
                return fsRename(source, renameTarget);
            },
        },
    }), /clean Page Manager failure/);
    await assert.rejects(access(target), /ENOENT/);
});

test('import rejects an MDX parent symlink without writing outside the project', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'riverbed-import-symlink-'));
    const external = await mkdtemp(path.join(tmpdir(), 'riverbed-import-external-'));
    await mkdir(path.join(root, 'src/album-manifests'), { recursive: true });
    await mkdir(path.join(root, 'src/content/albums'), { recursive: true });
    await symlink(external, path.join(root, 'src/content/albums/yama'));
    const proposal = createAlbumImport({ albumSlug: 'yama/escape', title: 'Escape', filenames: ['A.jpg'], order: 10 });

    await assert.rejects(commitAlbumImportSources(root, 'yama/escape', proposal), /symlink/i);
    await assert.rejects(access(path.join(external, 'escape.mdx')), /ENOENT/);
});

test('rename rejects an R2 Album directory symlink without touching external photos', async () => {
    const project = await lifecycleProject();
    const external = await mkdtemp(path.join(tmpdir(), 'riverbed-r2-external-'));
    await writeFile(path.join(external, 'A.jpg'), 'external-a', 'utf8');
    await writeFile(path.join(external, 'B.jpg'), 'external-b', 'utf8');
    await fsRename(project.r2, `${project.r2}-original`);
    await symlink(external, project.r2);

    await assert.rejects(executeAlbumPhotoRename(project.root, 'yama/source', [
        'yama/source/A.jpg', 'yama/source/B.jpg',
    ]), /symlink/i);
    assert.deepEqual((await readdir(external)).sort(), ['A.jpg', 'B.jpg']);
});

test('Album deletion refuses all source changes and reports sorted external cover consumers', async () => {
    const project = await lifecycleProject();
    let trashCalled = false;
    await assert.rejects(
        deleteAlbumSourceFiles(project.root, 'yama/source', async () => { trashCalled = true; }),
        (error) => error instanceof AlbumLifecycleConflictError &&
            error.code === 'external-cover-conflict' &&
            assert.deepEqual(error.consumerSlugs, ['k/consumer']) === undefined,
    );
    assert.equal(trashCalled, false);
    assert.equal(JSON.parse(await readFile(project.sourceManifest, 'utf8')).title, 'Source');
});

test('Album deletion trashes only the slug-paired MDX and manifest sources', async () => {
    const project = await lifecycleProject();
    await writeFile(project.consumerManifest, JSON.stringify(album({ title: 'Consumer' })), 'utf8');
    const legacySidecar = path.join(project.root, 'src/album-tags/yama/source.json');
    await mkdir(path.dirname(legacySidecar), { recursive: true });
    await writeFile(legacySidecar, '{}', 'utf8');
    let requested = [];

    await deleteAlbumSourceFiles(project.root, 'yama/source', async (paths) => {
        requested = paths;
        await Promise.all(paths.map((filename) => unlink(filename)));
    });

    assert.deepEqual(requested.map((filename) => path.basename(filename)
        .replace(/^\./, '')
        .replace(/\.\d+\.[^.]+\.delete$/, '')).sort(), [
        'source.json',
        'source.mdx',
    ]);
});

test('partial trash failure restores both paired Album sources', async () => {
    const project = await lifecycleProject();
    await writeFile(project.consumerManifest, JSON.stringify(album({ title: 'Consumer' })), 'utf8');
    const before = await Promise.all([
        readFile(project.sourceManifest, 'utf8'),
        readFile(project.mdx, 'utf8'),
    ]);

    await assert.rejects(deleteAlbumSourceFiles(project.root, 'yama/source', async (paths) => {
        await unlink(paths[0]);
        throw new Error('injected partial trash failure');
    }), /injected partial trash failure/);

    assert.deepEqual(await Promise.all([
        readFile(project.sourceManifest, 'utf8'),
        readFile(project.mdx, 'utf8'),
    ]), before);
});

test('Page Manager proposal keeps manifest inventory in MDX order and preserves source metadata', () => {
    const proposal = buildAlbumPageProposal({
        albumSlug: 'yama/source',
        manifest: album(),
        mdx: '<Row>\n  <Photo itemKey="B.jpg" />\n  <Photo itemKey="C.jpg" />\n</Row>\n',
        importedFilenames: ['C.jpg'],
        metadata: { title: 'Edited', info: undefined, gap: '3rem' },
    });

    assert.equal(proposal.title, 'Edited');
    assert.equal(proposal.info, undefined);
    assert.equal(proposal.gap, '3rem');
    assert.deepEqual(proposal.photos, [
        { filename: 'B.jpg', caption: undefined, tags: [{ name: 'Peak', x: 10, y: 20 }] },
        { filename: 'C.jpg', caption: undefined, tags: [] },
        { filename: 'A.jpg', caption: 'A', tags: [] },
    ]);
});

test('Page Manager proposal rejects an unimported or cross-Album content photo', () => {
    assert.throws(() => buildAlbumPageProposal({
        albumSlug: 'yama/source',
        manifest: album(),
        mdx: '<Photo itemKey="missing.jpg" />',
        importedFilenames: [],
    }), /not tracked or imported/);
    assert.throws(() => buildAlbumPageProposal({
        albumSlug: 'yama/source',
        manifest: album(),
        mdx: '<Photo itemKey="k/other/A.jpg" />',
        importedFilenames: [],
    }), /MDX|local filename/i);
});
