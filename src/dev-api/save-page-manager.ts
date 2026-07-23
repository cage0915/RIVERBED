import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import trash from 'trash';

import { validateImageFilename } from '../lib/album-import.js';
import { createLayoutOnlyPageContent, referencedLocalNames } from '../lib/page-structure';
import {
    AlbumAssetConflictError,
    AlbumLifecycleConflictError,
    AlbumSourceCommitError,
    AlbumSourceRollbackIncompleteError,
    assertAlbumAssetStorageSafe,
    buildAlbumPageProposal,
    commitAlbumPageSourcesWithinLock,
    findExternalCoverConsumers,
} from '../lib/albums/album-lifecycle';
import {
    readAlbumManifestFile,
    readAllAlbumManifestFiles,
    withAlbumManifestLocks,
} from '../lib/albums/manifest-files';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});
export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    try {
        const form = await request.formData();
        const albumSlug = String(form.get('albumSlug') || '');
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(albumSlug)) return json({ error: 'Invalid albumSlug' }, 400);
        const draft = JSON.parse(String(form.get('draft') || '{}')) as {
            blocks?: any[];
            metadata?: { title?: unknown; info?: unknown; gap?: unknown };
            removeLocal?: string[];
        };
        if (!Array.isArray(draft.blocks)) return json({ error: 'Invalid page draft' }, 400);
        if (!draft.metadata || typeof draft.metadata.title !== 'string' ||
            (draft.metadata.info !== undefined && typeof draft.metadata.info !== 'string') ||
            (draft.metadata.gap !== undefined && typeof draft.metadata.gap !== 'string')) {
            return json({ error: 'Invalid page metadata' }, 400);
        }
        const pageMetadata = {
            title: draft.metadata.title,
            info: draft.metadata.info as string | undefined,
            gap: draft.metadata.gap as string | undefined,
        };
        const blocks = draft.blocks;

        const projectRoot = process.cwd();
        const albumDirectory = path.resolve(projectRoot, 'r2', albumSlug);
        const allowedRoot = path.resolve(projectRoot, 'r2') + path.sep;
        const mdxPath = path.resolve(projectRoot, 'src/content/albums', `${albumSlug}.mdx`);
        if (!albumDirectory.startsWith(allowedRoot) || !fs.existsSync(mdxPath)) return json({ error: 'Page does not exist' }, 404);
        await assertAlbumAssetStorageSafe(projectRoot, albumSlug);

        const files = form.getAll('photos').filter((entry): entry is File => typeof entry !== 'string');
        const names = files.map((file) => validateImageFilename(file.name));
        if (new Set(names).size !== names.length) return json({ error: 'Duplicate import filenames' }, 409);
        const removals = (draft.removeLocal || []).map(validateImageFilename);
        if (new Set(removals).size !== removals.length) return json({ error: 'Duplicate local removals' }, 400);
        if (names.some((name) => removals.includes(name))) return json({ error: 'A photo cannot be imported and removed together' }, 409);

        const referenced = referencedLocalNames(blocks);
        const protectedRemoval = removals.find((name) => referenced.has(name));
        if (protectedRemoval) return json({ error: `${protectedRemoval} is still referenced by the page draft` }, 409);

        const payloads = await Promise.all(files.map(async (file, index) => ({
            name: names[index],
            bytes: new Uint8Array(await file.arrayBuffer()),
        })));
        const initialManifests = await readAllAlbumManifestFiles(projectRoot);
        if (!initialManifests[albumSlug]) return json({ error: 'Page does not exist' }, 404);
        return await withAlbumManifestLocks(projectRoot, Object.keys(initialManifests), async () => {
            await assertAlbumAssetStorageSafe(projectRoot, albumSlug);
            const manifests = await readAllAlbumManifestFiles(projectRoot);
            const currentManifest = await readAlbumManifestFile(projectRoot, albumSlug);
            for (const name of removals) {
                if (!fs.existsSync(path.join(albumDirectory, name))) {
                    return json({ error: `Local photo no longer exists: ${name}` }, 409);
                }
            }
            for (const name of removals) {
                const consumers = findExternalCoverConsumers(manifests, `${albumSlug}/${name}`);
                if (consumers.length > 0) throw new AlbumLifecycleConflictError(`${albumSlug}/${name}`, consumers);
            }
            if (
                currentManifest.cover.photo.kind === 'local' &&
                removals.includes(currentManifest.cover.photo.filename)
            ) {
                return json({ error: `${currentManifest.cover.photo.filename} is still selected as the local cover` }, 409);
            }

            const newContent = createLayoutOnlyPageContent(blocks);
            const metadata = {
                title: pageMetadata.title,
                info: pageMetadata.info?.trim() ? pageMetadata.info : undefined,
                gap: pageMetadata.gap?.trim() ? pageMetadata.gap : undefined,
            };
            const proposedManifest = buildAlbumPageProposal({
                albumSlug,
                manifest: currentManifest,
                mdx: newContent,
                importedFilenames: names,
                metadata,
            });

            const committedAssets = await commitAlbumPageSourcesWithinLock({
                projectRoot,
                albumSlug,
                assets: payloads,
                sourceProposals: [
                    { target: mdxPath, content: newContent },
                    {
                        target: path.resolve(projectRoot, 'src/album-manifests', `${albumSlug}.json`),
                        content: `${JSON.stringify(proposedManifest, null, 2)}\n`,
                    },
                ],
            });

            if (removals.length) {
                try {
                    await trash(removals.map((name) => path.join(albumDirectory, name)), { glob: false });
                } catch (error) {
                    throw new AggregateError(
                        [error],
                        'Page sources were saved, but local photo cleanup failed; retry cleanup from R2 Manager',
                    );
                }
            }
            return json({ success: true, copied: committedAssets.copied, removed: removals });
        });
    } catch (error) {
        if (error instanceof AlbumSourceRollbackIncompleteError) {
            return json({
                error: error.message,
                code: error.code,
                outcome: error.outcome,
                recoveryArtifacts: error.recoveryArtifacts,
            }, 500);
        }
        if (error instanceof AlbumAssetConflictError) {
            return json({ error: error.message, conflicts: error.filenames }, 409);
        }
        if (error instanceof AlbumLifecycleConflictError) {
            return json({ error: error.message, consumers: error.consumerSlugs }, 409);
        }
        const status = (error instanceof AlbumSourceCommitError ||
            error instanceof AggregateError && /sources were saved/.test(error.message)) ? 500 : 400;
        return json({ error: error instanceof Error ? error.message : 'Page Manager save failed' }, status);
    }
};
// Registered only by the local development server.
