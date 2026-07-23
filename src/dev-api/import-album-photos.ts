import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

import { createAlbumImport, validateAlbumSegment, validateImageFilename } from '../lib/album-import.js';
import {
    AlbumAssetConflictError,
    AlbumSourceRollbackIncompleteError,
    assertAlbumAssetStorageSafe,
    commitAlbumAssets,
    commitAlbumImportSources,
    nextAlbumOrder,
} from '../lib/albums/album-lifecycle';
import { readAllAlbumManifestFiles } from '../lib/albums/manifest-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);

    try {
        const form = await request.formData();
        const folder = validateAlbumSegment(form.get('folder'), 'Folder');
        const album = validateAlbumSegment(form.get('albumSlug'));
        const title = String(form.get('title') || album).trim();
        const createPage = form.get('createPage') === 'true';
        const files = form.getAll('photos').filter((entry): entry is File => typeof entry !== 'string');
        if (files.length === 0) return json({ error: 'Select at least one photo' }, 400);
        const names = files.map((file) => validateImageFilename(file.name));
        if (new Set(names).size !== names.length) return json({ error: 'Duplicate photo filenames are not allowed' }, 409);

        const projectRoot = process.cwd();
        const albumDir = path.resolve(projectRoot, 'r2', folder, album);
        const allowedAlbumRoot = path.resolve(projectRoot, 'r2', folder) + path.sep;
        const mdxPath = path.resolve(projectRoot, 'src/content/albums', folder, `${album}.mdx`);
        const manifestPath = path.resolve(projectRoot, 'src/album-manifests', folder, `${album}.json`);
        if (!albumDir.startsWith(allowedAlbumRoot)) return json({ error: 'Invalid target path' }, 400);
        if (createPage && (fs.existsSync(mdxPath) || fs.existsSync(manifestPath))) return json({ error: 'Page already exists' }, 409);
        if (!createPage && (!fs.existsSync(mdxPath) || !fs.existsSync(manifestPath))) return json({ error: 'Page does not exist' }, 404);

        const albumSlug = `${folder}/${album}`;
        await assertAlbumAssetStorageSafe(projectRoot, albumSlug);
        const importProposal = createPage
            ? createAlbumImport({
                albumSlug,
                title,
                filenames: names,
                order: nextAlbumOrder(await readAllAlbumManifestFiles(projectRoot), folder),
            })
            : undefined;

        const payloads = await Promise.all(files.map(async (file, index) => ({
            name: names[index],
            bytes: new Uint8Array(await file.arrayBuffer()),
        })));

        let copied: string[] = [];
        let skipped: string[] = [];
        if (createPage) {
            const committed = await commitAlbumImportSources(
                projectRoot,
                albumSlug,
                importProposal!,
                payloads,
            );
            copied = committed.copied;
            skipped.splice(0, skipped.length, ...committed.skipped);
        } else {
            const committed = await commitAlbumAssets(projectRoot, albumSlug, payloads);
            copied = committed.copied;
            skipped = committed.skipped;
        }

        return json({
            success: true,
            copied,
            skipped,
            redirectUrl: `/${folder}/${album}`,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed';
        if (error instanceof AlbumSourceRollbackIncompleteError) {
            return json({
                error: message,
                code: error.code,
                outcome: error.outcome,
                recoveryArtifacts: error.recoveryArtifacts,
            }, 500);
        }
        if (error instanceof AlbumAssetConflictError) {
            return json({ error: message, conflicts: error.filenames }, 409);
        }
        if ((error as NodeJS.ErrnoException)?.code === 'EEXIST' ||
            /Album source already exists|Page already exists/.test(message)) {
            return json({ error: message }, 409);
        }
        if (/Unable to read Album manifest|Album source does not exist/.test(message)) return json({ error: message }, 404);
        return json({ error: message }, 400);
    }
};
// Registered only by the local development server.
