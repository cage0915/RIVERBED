import { randomUUID } from 'node:crypto';
import {
    link,
    lstat,
    mkdir,
    readdir,
    readFile,
    realpath,
    rename,
    unlink,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';

import { normalizeAssetKey, validateAlbumSlug, validateLocalPhotoFilename } from './keys.ts';
import { parseAlbumManifest } from './manifest-schema.ts';
import { extractMdxPhotos } from './mdx-photos.ts';
import { validateAlbumInventory } from './validation.ts';
import type { AlbumManifest } from './types.ts';
import { readAlbumManifestFile, readAllAlbumManifestFiles, withAlbumManifestLocks } from './manifest-files.ts';

export class AlbumAssetConflictError extends Error {
    readonly code = 'album-asset-conflict';
    readonly filenames: string[];

    constructor(filenames: string[]) {
        const conflicts = [...new Set(filenames.map(validateLocalPhotoFilename))].sort();
        super(`Different local photos already use: ${conflicts.join(', ')}`);
        this.name = 'AlbumAssetConflictError';
        this.filenames = conflicts;
    }
}

export class AlbumLifecycleConflictError extends Error {
    readonly code = 'external-cover-conflict';
    readonly assetKey: string;
    readonly consumerSlugs: string[];

    constructor(assetKey: string, consumerSlugs: string[]) {
        const normalizedKey = normalizeAssetKey(assetKey);
        const consumers = [...new Set(consumerSlugs.map(validateAlbumSlug))].sort();
        super(`${normalizedKey} is used as an external cover by: ${consumers.join(', ')}`);
        this.name = 'AlbumLifecycleConflictError';
        this.assetKey = normalizedKey;
        this.consumerSlugs = consumers;
    }
}

export function findExternalCoverConsumers(
    manifests: Record<string, AlbumManifest>,
    assetKey: string,
): string[] {
    const key = normalizeAssetKey(assetKey);
    return Object.entries(manifests)
        .filter(([, manifest]) =>
            manifest.cover.photo.kind === 'external' && manifest.cover.photo.assetKey === key
        )
        .map(([slug]) => validateAlbumSlug(slug))
        .sort();
}

export function findAlbumDeletionConsumers(
    manifests: Record<string, AlbumManifest>,
    albumSlug: string,
): string[] {
    const slug = validateAlbumSlug(albumSlug);
    return [...new Set(Object.entries(manifests)
        .filter(([consumerSlug, manifest]) =>
            consumerSlug !== slug &&
            manifest.cover.photo.kind === 'external' &&
            manifest.cover.photo.assetKey.startsWith(`${slug}/`)
        )
        .map(([consumerSlug]) => validateAlbumSlug(consumerSlug)))]
        .sort();
}

export async function withR2SourceAlbumLocks<T>(
    projectRoot: string,
    assetKeys: string[],
    operation: () => Promise<T>,
): Promise<T> {
    const sourceSlugs = [...new Set(assetKeys.map((assetKey) => {
        const [folder, album] = normalizeAssetKey(assetKey).split('/');
        return validateAlbumSlug(`${folder}/${album}`);
    }))];
    return withAlbumManifestLocks(projectRoot, sourceSlugs, operation);
}

function replaceMdxPhotoFilenames(mdx: string, renameMap: Map<string, string>): string {
    // Offsets come from the project-scoped extractor, so code examples and comments stay untouched.
    const references = extractMdxPhotos(mdx);
    let result = mdx;
    for (const reference of [...references].sort((a, b) => b.offset - a.offset)) {
        const replacement = renameMap.get(reference.filename);
        if (replacement === undefined) continue;
        const tag = reference.context.replace(
            /(\bitemKey\s*=\s*)(["'])([^"']+)(\2)/,
            (_attribute, prefix, quote, _filename, closingQuote) =>
                `${prefix}${quote}${replacement}${closingQuote}`,
        );
        result = `${result.slice(0, reference.offset)}${tag}${result.slice(reference.offset + reference.context.length)}`;
    }
    return result;
}

export function buildPhotoRenameProposal(input: {
    albumSlug: string;
    mdx: string;
    manifests: Record<string, AlbumManifest>;
    renameMap: Map<string, string>;
}): { mdx: string; manifests: Record<string, AlbumManifest> } {
    const albumSlug = validateAlbumSlug(input.albumSlug);
    const source = input.manifests[albumSlug];
    if (!source) throw new Error(`Album manifest not found: ${albumSlug}`);

    const renameMap = new Map([...input.renameMap].map(([oldName, newName]) => [
        validateLocalPhotoFilename(oldName),
        validateLocalPhotoFilename(newName),
    ]));
    for (const oldName of renameMap.keys()) {
        if (!source.photos.some(({ filename }) => filename === oldName)) {
            throw new Error(`Photo not found in Album manifest: ${oldName}`);
        }
    }
    const resultingNames = source.photos.map(({ filename }) => renameMap.get(filename) ?? filename);
    if (new Set(resultingNames).size !== resultingNames.length) {
        throw new Error('Photo rename would create duplicate manifest filenames');
    }

    const mdx = replaceMdxPhotoFilenames(input.mdx, renameMap);
    const manifests = Object.fromEntries(Object.entries(input.manifests).map(([slug, manifest]) => {
        let proposed: AlbumManifest = manifest;
        if (slug === albumSlug) {
            proposed = {
                ...manifest,
                cover: manifest.cover.photo.kind === 'local'
                    ? {
                        ...manifest.cover,
                        photo: {
                            kind: 'local',
                            filename: renameMap.get(manifest.cover.photo.filename) ?? manifest.cover.photo.filename,
                        },
                    }
                    : manifest.cover,
                photos: manifest.photos.map((photo) => ({
                    ...photo,
                    filename: renameMap.get(photo.filename) ?? photo.filename,
                })),
            };
        } else if (manifest.cover.photo.kind === 'external') {
            const prefix = `${albumSlug}/`;
            if (manifest.cover.photo.assetKey.startsWith(prefix)) {
                const filename = manifest.cover.photo.assetKey.slice(prefix.length);
                const replacement = renameMap.get(filename);
                if (replacement) {
                    proposed = {
                        ...manifest,
                        cover: {
                            ...manifest.cover,
                            photo: { kind: 'external', assetKey: `${albumSlug}/${replacement}` },
                        },
                    };
                }
            }
        }
        return [slug, parseAlbumManifest(proposed, slug)];
    }));

    const diagnostics = validateAlbumInventory({
        albumSlug,
        manifestPath: `src/album-manifests/${albumSlug}.json`,
        manifest: manifests[albumSlug],
        mdxPath: `src/content/albums/${albumSlug}.mdx`,
        mdxBody: mdx,
    });
    if (diagnostics.length > 0) {
        throw new Error(`Invalid photo rename proposal: ${diagnostics.map(({ code }) => code).join(', ')}`);
    }
    return { mdx, manifests };
}

type RenameItem = {
    oldName: string;
    newName: string;
    status: 'rename' | 'unchanged' | 'missing' | 'conflict' | 'duplicate';
};

export class AlbumRenamePlanError extends Error {
    readonly code = 'rename-plan-conflict';
    readonly items: RenameItem[];
    constructor(items: RenameItem[]) {
        super('Rename plan contains blocking issues');
        this.name = 'AlbumRenamePlanError';
        this.items = items;
    }
}

type SourceProposal = { target: string; content: string };
type SourceFileOperations = {
    writeFile?: typeof writeFile;
    rename?: typeof rename;
    unlink?: typeof unlink;
    link?: typeof link;
};

export class AlbumSourceCommitError extends Error {
    readonly code = 'source-commit-cleanup-incomplete';
    readonly committed = true;
    readonly cleanupErrors: unknown[];
    constructor(cleanupErrors: unknown[]) {
        super('Album source files were committed, but backup cleanup is incomplete');
        this.name = 'AlbumSourceCommitError';
        this.cleanupErrors = cleanupErrors;
    }
}

export class AlbumSourceRollbackIncompleteError extends Error {
    readonly code = 'source-rollback-incomplete';
    readonly outcome = 'unknown' as const;
    readonly operation: 'create' | 'replace';
    readonly commitError: unknown;
    readonly rollbackErrors: unknown[];
    readonly recoveryArtifacts: string[];

    constructor(
        operation: 'create' | 'replace',
        commitError: unknown,
        rollbackErrors: unknown[],
        recoveryArtifacts: string[],
    ) {
        super(`Album source ${operation} failed and rollback was incomplete; outcome is unknown`);
        this.name = 'AlbumSourceRollbackIncompleteError';
        this.operation = operation;
        this.commitError = commitError;
        this.rollbackErrors = rollbackErrors;
        this.recoveryArtifacts = [...new Set(recoveryArtifacts)].sort();
    }
}

async function pathExists(filename: string): Promise<boolean> {
    try {
        await lstat(filename);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
    }
}

async function existingRecoveryArtifacts(candidates: string[]): Promise<string[]> {
    const existing: string[] = [];
    for (const candidate of [...new Set(candidates)]) {
        try {
            if (await pathExists(candidate)) existing.push(candidate);
        } catch {
            // Keep the path in the recovery report when its state cannot be inspected safely.
            existing.push(candidate);
        }
    }
    return existing.sort();
}

function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function assertSafeWorkspacePath(
    projectRoot: string,
    candidateInput: string,
    label: string,
): Promise<void> {
    const root = await realpath(path.resolve(projectRoot));
    const candidate = path.resolve(candidateInput);
    if (!isContained(root, candidate)) throw new Error(`${label} escapes the project root`);
    const relative = path.relative(root, candidate);
    let current = root;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
        current = path.join(current, segment);
        try {
            const stats = await lstat(current);
            if (stats.isSymbolicLink()) throw new Error(`${label} must not contain symlinks`);
            const resolved = await realpath(current);
            if (!isContained(root, resolved)) throw new Error(`${label} escapes the project root`);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') break;
            throw error;
        }
    }
}

export async function buildSequentialRenamePlan(
    r2Directory: string,
    albumSlug: string,
    orderedKeys: string[],
): Promise<RenameItem[]> {
    const slug = validateAlbumSlug(albumSlug);
    await assertAlbumAssetStorageSafe(path.resolve(r2Directory, '../../..'), slug);
    const prefix = `${slug}/`;
    const sourceNames = orderedKeys.map((key) => {
        if (!key.startsWith(prefix) || key.slice(prefix.length).includes('/')) {
            throw new Error(`Photo key is outside the source Album: ${key}`);
        }
        return validateLocalPhotoFilename(key.slice(prefix.length));
    });
    const sourceSet = new Set(sourceNames);
    const seen = new Set<string>();
    const result: RenameItem[] = [];
    for (const [index, oldName] of sourceNames.entries()) {
        const extension = path.extname(oldName).toLowerCase();
        const newName = `${String(index + 1).padStart(3, '0')}${extension}`;
        let status: RenameItem['status'];
        if (seen.has(oldName)) status = 'duplicate';
        else if (!await pathExists(path.join(r2Directory, oldName))) status = 'missing';
        else if (oldName === newName) status = 'unchanged';
        else if (await pathExists(path.join(r2Directory, newName)) && !sourceSet.has(newName)) status = 'conflict';
        else status = 'rename';
        seen.add(oldName);
        result.push({ oldName, newName, status });
    }
    return result;
}

async function applyLocalR2RenamePlan(
    r2Directory: string,
    items: RenameItem[],
    renamePath: typeof rename = rename,
): Promise<() => Promise<void>> {
    const projectRoot = path.resolve(r2Directory, '../../..');
    const renamed = items.filter(({ status }) => status === 'rename');
    const token = `.__album_rename_${process.pid}_${randomUUID()}`;
    const staged: RenameItem[] = [];
    const completed: RenameItem[] = [];
    try {
        for (const item of renamed) {
            await assertSafeWorkspacePath(projectRoot, path.join(r2Directory, item.oldName), 'R2 photo path');
            await renamePath(path.join(r2Directory, item.oldName), path.join(r2Directory, item.oldName + token));
            staged.push(item);
        }
        for (const item of renamed) {
            await assertSafeWorkspacePath(projectRoot, path.join(r2Directory, item.oldName + token), 'R2 photo path');
            await renamePath(path.join(r2Directory, item.oldName + token), path.join(r2Directory, item.newName));
            completed.push(item);
        }
    } catch (error) {
        const rollbackToken = `.__album_apply_rollback_${process.pid}_${randomUUID()}`;
        const rollbackStaged: RenameItem[] = [];
        const rollbackStageErrors: unknown[] = [];
        for (const item of completed) {
            try {
                await renamePath(
                    path.join(r2Directory, item.newName),
                    path.join(r2Directory, item.newName + rollbackToken),
                );
                rollbackStaged.push(item);
            } catch (failure) {
                rollbackStageErrors.push(failure);
            }
        }
        if (rollbackStageErrors.length > 0) {
            const recoveryErrors: unknown[] = [];
            for (const item of [...rollbackStaged].reverse()) {
                await renamePath(
                    path.join(r2Directory, item.newName + rollbackToken),
                    path.join(r2Directory, item.newName),
                ).catch((failure) => recoveryErrors.push(failure));
            }
            throw new AggregateError(
                [error, ...rollbackStageErrors, ...recoveryErrors],
                recoveryErrors.length > 0
                    ? 'R2 rename apply failed; rollback staging and recovery were incomplete'
                    : 'R2 rename apply failed; rollback could not be staged safely',
            );
        }
        const rollbackErrors: unknown[] = [];
        for (const item of rollbackStaged) {
            await renamePath(
                path.join(r2Directory, item.newName + rollbackToken),
                path.join(r2Directory, item.oldName),
            ).catch((failure) => rollbackErrors.push(failure));
        }
        for (const item of staged.filter((candidate) => !completed.includes(candidate))) {
            await renamePath(
                path.join(r2Directory, item.oldName + token),
                path.join(r2Directory, item.oldName),
            ).catch((failure) => rollbackErrors.push(failure));
        }
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                'R2 rename apply failed and rollback was incomplete',
            );
        }
        throw error;
    }
    return async () => {
        const reverseToken = `.__album_rollback_${process.pid}_${randomUUID()}`;
        const stagedReverse: RenameItem[] = [];
        const restored: RenameItem[] = [];
        try {
            for (const item of renamed) {
                await renamePath(path.join(r2Directory, item.newName), path.join(r2Directory, item.newName + reverseToken));
                stagedReverse.push(item);
            }
            for (const item of renamed) {
                await renamePath(path.join(r2Directory, item.newName + reverseToken), path.join(r2Directory, item.oldName));
                restored.push(item);
            }
        } catch (error) {
            const recoveryErrors: unknown[] = [];
            for (const item of [...restored].reverse()) {
                await renamePath(path.join(r2Directory, item.oldName), path.join(r2Directory, item.newName))
                    .catch((failure) => recoveryErrors.push(failure));
            }
            for (const item of [...stagedReverse].reverse()) {
                if (restored.includes(item)) continue;
                await renamePath(path.join(r2Directory, item.newName + reverseToken), path.join(r2Directory, item.newName))
                    .catch((failure) => recoveryErrors.push(failure));
            }
            if (recoveryErrors.length > 0) {
                throw new AggregateError(
                    [error, ...recoveryErrors],
                    'R2 rename compensation failed and recovery to the renamed state was incomplete',
                );
            }
            throw error;
        }
    };
}

export async function replaceSourceFilesAtomically(
    proposals: SourceProposal[],
    projectRoot = process.cwd(),
    operations: SourceFileOperations = {},
): Promise<void> {
    const writeSource = operations.writeFile ?? writeFile;
    const renameSource = operations.rename ?? rename;
    const unlinkSource = operations.unlink ?? unlink;
    const sorted = [...proposals].sort((a, b) => a.target.localeCompare(b.target));
    const staged: Array<SourceProposal & { temporary: string; backup: string; backedUp: boolean; replaced: boolean }> = [];
    try {
        for (const proposal of sorted) {
            await assertSafeWorkspacePath(projectRoot, proposal.target, 'Album source path');
            await mkdir(path.dirname(proposal.target), { recursive: true });
            await assertSafeWorkspacePath(projectRoot, proposal.target, 'Album source path');
            const token = `${process.pid}.${randomUUID()}`;
            const entry = {
                ...proposal,
                temporary: path.join(path.dirname(proposal.target), `.${path.basename(proposal.target)}.${token}.tmp`),
                backup: path.join(path.dirname(proposal.target), `.${path.basename(proposal.target)}.${token}.bak`),
                backedUp: false,
                replaced: false,
            };
            staged.push(entry);
            await writeSource(entry.temporary, proposal.content, { encoding: 'utf8', flag: 'wx' });
        }
        for (const entry of staged) {
            await assertSafeWorkspacePath(projectRoot, entry.target, 'Album source path');
            await renameSource(entry.target, entry.backup);
            entry.backedUp = true;
            await renameSource(entry.temporary, entry.target);
            entry.replaced = true;
        }
        const cleanupErrors: unknown[] = [];
        for (const { backup } of staged) {
            await unlinkSource(backup).catch((error) => cleanupErrors.push(error));
        }
        if (cleanupErrors.length > 0) throw new AlbumSourceCommitError(cleanupErrors);
    } catch (error) {
        if (error instanceof AlbumSourceCommitError) throw error;
        const rollbackErrors: unknown[] = [];
        for (const entry of [...staged].reverse()) {
            let targetRemoved = !entry.replaced;
            if (entry.replaced) {
                try {
                    await unlinkSource(entry.target);
                    targetRemoved = true;
                } catch (failure) {
                    rollbackErrors.push(failure);
                    targetRemoved = false;
                }
            }
            if (entry.backedUp && targetRemoved) {
                await renameSource(entry.backup, entry.target)
                    .catch((failure) => rollbackErrors.push(failure));
            }
        }
        if (rollbackErrors.length === 0) {
            for (const entry of staged) {
                await unlinkSource(entry.temporary).catch((failure) => {
                    if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') rollbackErrors.push(failure);
                });
            }
        }
        if (rollbackErrors.length > 0) {
            const recoveryArtifacts = await existingRecoveryArtifacts(staged.flatMap((entry) => [
                entry.target,
                entry.temporary,
                entry.backup,
            ]));
            throw new AlbumSourceRollbackIncompleteError(
                'replace', error, rollbackErrors, recoveryArtifacts,
            );
        }
        throw error;
    }
}

export async function executeAlbumPhotoRename(
    projectRoot: string,
    albumSlugInput: string,
    orderedKeys: string[],
    operations: {
        applyR2Plan?: (directory: string, plan: RenameItem[]) => Promise<() => Promise<void>>;
        commitSourceFiles?: (proposals: SourceProposal[]) => Promise<void>;
        renameR2Path?: typeof rename;
    } = {},
): Promise<{ items: RenameItem[]; renamed: Record<string, string> }> {
    const albumSlug = validateAlbumSlug(albumSlugInput);
    const initialManifests = await readAllAlbumManifestFiles(projectRoot);
    if (!initialManifests[albumSlug]) throw new Error(`Album manifest not found: ${albumSlug}`);
    const lockSlugs = Object.keys(initialManifests);
    return withAlbumManifestLocks(projectRoot, lockSlugs, async () => {
        const manifests = await readAllAlbumManifestFiles(projectRoot);
        const r2Directory = path.resolve(projectRoot, 'r2', albumSlug);
        const mdxPath = path.resolve(projectRoot, 'src/content/albums', `${albumSlug}.mdx`);
        const mdx = await readFile(mdxPath, 'utf8');
        const items = await buildSequentialRenamePlan(r2Directory, albumSlug, orderedKeys);
        const blocking = items.filter(({ status }) => ['missing', 'conflict', 'duplicate'].includes(status));
        if (blocking.length > 0) throw new AlbumRenamePlanError(items);
        const renameMap = new Map(items
            .filter(({ status }) => status === 'rename')
            .map(({ oldName, newName }) => [oldName, newName]));
        if (renameMap.size === 0) return { items, renamed: {} };

        const proposal = buildPhotoRenameProposal({ albumSlug, mdx, manifests, renameMap });
        const changedSlugs = Object.keys(manifests).filter((slug) =>
            JSON.stringify(proposal.manifests[slug]) !== JSON.stringify(manifests[slug])
        );
        const sourceProposals: SourceProposal[] = [
            { target: mdxPath, content: proposal.mdx },
            ...changedSlugs.map((slug) => ({
                target: path.resolve(projectRoot, 'src/album-manifests', `${slug}.json`),
                content: `${JSON.stringify(proposal.manifests[slug], null, 2)}\n`,
            })),
        ];

        const applyR2Plan = operations.applyR2Plan ?? ((directory, plan) =>
            applyLocalR2RenamePlan(directory, plan, operations.renameR2Path));
        const commitSourceFiles = operations.commitSourceFiles ?? ((proposals) =>
            replaceSourceFilesAtomically(proposals, projectRoot));
        const compensate = await applyR2Plan(r2Directory, items);
        try {
            await commitSourceFiles(sourceProposals);
        } catch (sourceError) {
            if (sourceError instanceof AlbumSourceCommitError ||
                sourceError instanceof AlbumSourceRollbackIncompleteError) {
                throw sourceError;
            }
            try {
                await compensate();
            } catch (compensationError) {
                throw new AggregateError(
                    [sourceError, compensationError],
                    'Source replacement failed and R2 compensation was incomplete',
                );
            }
            throw sourceError;
        }
        return { items, renamed: Object.fromEntries(renameMap) };
    });
}

async function createSourceFilesAtomically(
    projectRoot: string,
    proposals: SourceProposal[],
    operations: SourceFileOperations = {},
): Promise<void> {
    const writeSource = operations.writeFile ?? writeFile;
    const linkSource = operations.link ?? link;
    const unlinkSource = operations.unlink ?? unlink;
    const sorted = [...proposals].sort((a, b) => a.target.localeCompare(b.target));
    const staged: Array<SourceProposal & { temporary: string; created: boolean }> = [];
    try {
        for (const proposal of sorted) {
            await assertSafeWorkspacePath(projectRoot, proposal.target, 'Album source path');
            if (await pathExists(proposal.target)) throw new Error(`Album source already exists: ${proposal.target}`);
            await mkdir(path.dirname(proposal.target), { recursive: true });
            await assertSafeWorkspacePath(projectRoot, proposal.target, 'Album source path');
            const temporary = path.join(
                path.dirname(proposal.target),
                `.${path.basename(proposal.target)}.${process.pid}.${randomUUID()}.tmp`,
            );
            staged.push({ ...proposal, temporary, created: false });
            await writeSource(temporary, proposal.content, { encoding: 'utf8', flag: 'wx' });
        }
        for (const entry of staged) {
            await assertSafeWorkspacePath(projectRoot, entry.target, 'Album source path');
            // link is used instead of rename so an unexpected existing target is never overwritten.
            await linkSource(entry.temporary, entry.target);
            entry.created = true;
            await unlinkSource(entry.temporary);
        }
    } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const entry of [...staged].reverse()) {
            if (entry.created) {
                await unlinkSource(entry.target).catch((failure) => rollbackErrors.push(failure));
            }
        }
        if (rollbackErrors.length === 0) {
            for (const entry of staged) {
                await unlinkSource(entry.temporary).catch((failure) => {
                    if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') rollbackErrors.push(failure);
                });
            }
        }
        if (rollbackErrors.length > 0) {
            const recoveryArtifacts = await existingRecoveryArtifacts(staged.flatMap((entry) => [
                entry.target,
                entry.temporary,
            ]));
            throw new AlbumSourceRollbackIncompleteError(
                'create', error, rollbackErrors, recoveryArtifacts,
            );
        }
        throw error;
    }
}

export async function commitAlbumImportSources(
    projectRoot: string,
    albumSlugInput: string,
    proposal: { mdx: string; manifest: AlbumManifest },
    assets: Array<{ name: string; bytes: Uint8Array }> = [],
    operations: { writeAsset?: typeof writeFile; sourceFiles?: SourceFileOperations } = {},
): Promise<{ copied: string[]; skipped: string[] }> {
    const albumSlug = validateAlbumSlug(albumSlugInput);
    const manifest = parseAlbumManifest(proposal.manifest, albumSlug);
    const diagnostics = validateAlbumInventory({
        albumSlug,
        manifestPath: `src/album-manifests/${albumSlug}.json`,
        manifest,
        mdxPath: `src/content/albums/${albumSlug}.mdx`,
        mdxBody: proposal.mdx,
    });
    if (diagnostics.length > 0) {
        throw new Error(`Invalid Album import proposal: ${diagnostics.map(({ code }) => code).join(', ')}`);
    }
    return withAlbumManifestLocks(projectRoot, [albumSlug], async () => {
        const [folder] = albumSlug.split('/');
        const current = await readAllAlbumManifestFiles(projectRoot);
        if (current[albumSlug]) throw new Error(`Album source already exists: ${albumSlug}`);
        const finalManifest = parseAlbumManifest({
            ...manifest,
            order: nextAlbumOrder(current, folder),
        }, albumSlug);
        const finalDiagnostics = validateAlbumInventory({
            albumSlug,
            manifestPath: `src/album-manifests/${albumSlug}.json`,
            manifest: finalManifest,
            mdxPath: `src/content/albums/${albumSlug}.mdx`,
            mdxBody: proposal.mdx,
        });
        if (finalDiagnostics.length > 0) {
            throw new Error(`Invalid Album import proposal: ${finalDiagnostics.map(({ code }) => code).join(', ')}`);
        }
        let committedAssets: { copied: string[]; skipped: string[] } | undefined;
        try {
            committedAssets = await commitAlbumAssetsWithinLock(projectRoot, albumSlug, assets, operations);
            await createSourceFilesAtomically(projectRoot, [
                {
                    target: path.resolve(projectRoot, 'src/album-manifests', `${albumSlug}.json`),
                    content: `${JSON.stringify(finalManifest, null, 2)}\n`,
                },
                {
                    target: path.resolve(projectRoot, 'src/content/albums', `${albumSlug}.mdx`),
                    content: proposal.mdx,
                },
            ], operations.sourceFiles);
        } catch (error) {
            if (error instanceof AlbumSourceRollbackIncompleteError) throw error;
            const cleanupErrors: unknown[] = [];
            for (const name of committedAssets?.copied ?? []) {
                await unlink(path.resolve(projectRoot, 'r2', albumSlug, name))
                    .catch((failure) => cleanupErrors.push(failure));
            }
            if (cleanupErrors.length > 0) {
                throw new AggregateError([error, ...cleanupErrors], 'Album import failed and asset cleanup was incomplete');
            }
            throw error;
        }
        return committedAssets;
    });
}

export async function commitAlbumAssetsWithinLock(
    projectRoot: string,
    albumSlugInput: string,
    assets: Array<{ name: string; bytes: Uint8Array }>,
    operations: { writeAsset?: typeof writeFile } = {},
): Promise<{ copied: string[]; skipped: string[] }> {
    const albumSlug = validateAlbumSlug(albumSlugInput);
    const normalized = assets.map((asset) => ({
        name: validateLocalPhotoFilename(asset.name),
        bytes: asset.bytes,
    }));
    if (new Set(normalized.map(({ name }) => name)).size !== normalized.length) {
        throw new Error('Duplicate Album asset filenames');
    }
    const assetDirectory = path.resolve(projectRoot, 'r2', albumSlug);
    await assertAlbumAssetStorageSafe(projectRoot, albumSlug);
    await mkdir(assetDirectory, { recursive: true });
    await assertAlbumAssetStorageSafe(projectRoot, albumSlug);

    const skipped: string[] = [];
    const conflicts: string[] = [];
    for (const asset of normalized) {
        const target = path.join(assetDirectory, asset.name);
        await assertSafeWorkspacePath(projectRoot, target, 'R2 photo path');
        if (!await pathExists(target)) continue;
        const currentBytes = await readFile(target);
        if (currentBytes.equals(Buffer.from(asset.bytes))) skipped.push(asset.name);
        else conflicts.push(asset.name);
    }
    if (conflicts.length > 0) throw new AlbumAssetConflictError(conflicts);

    const copied: string[] = [];
    const writeAsset = operations.writeAsset ?? writeFile;
    let writingName: string | undefined;
    try {
        for (const asset of normalized) {
            if (skipped.includes(asset.name)) continue;
            writingName = asset.name;
            await writeAsset(path.join(assetDirectory, asset.name), asset.bytes, { flag: 'wx' });
            copied.push(asset.name);
            writingName = undefined;
        }
    } catch (error) {
        const cleanupErrors: unknown[] = [];
        for (const name of copied) {
            await unlink(path.join(assetDirectory, name)).catch((failure) => cleanupErrors.push(failure));
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError([error, ...cleanupErrors], 'Album asset commit failed and cleanup was incomplete');
        }
        if ((error as NodeJS.ErrnoException).code === 'EEXIST' && writingName) {
            throw new AlbumAssetConflictError([writingName]);
        }
        throw error;
    }
    return { copied, skipped };
}

export async function commitAlbumPageSourcesWithinLock(input: {
    projectRoot: string;
    albumSlug: string;
    assets: Array<{ name: string; bytes: Uint8Array }>;
    sourceProposals: SourceProposal[];
    sourceOperations?: SourceFileOperations;
}): Promise<{ copied: string[]; skipped: string[] }> {
    const albumSlug = validateAlbumSlug(input.albumSlug);
    let committedAssets: { copied: string[]; skipped: string[] } | undefined;
    try {
        committedAssets = await commitAlbumAssetsWithinLock(
            input.projectRoot, albumSlug, input.assets,
        );
        await replaceSourceFilesAtomically(
            input.sourceProposals, input.projectRoot, input.sourceOperations,
        );
        return committedAssets;
    } catch (error) {
        if (error instanceof AlbumSourceCommitError ||
            error instanceof AlbumSourceRollbackIncompleteError) {
            throw error;
        }
        const cleanupErrors: unknown[] = [];
        for (const name of committedAssets?.copied ?? []) {
            await unlink(path.resolve(input.projectRoot, 'r2', albumSlug, name))
                .catch((failure) => cleanupErrors.push(failure));
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError(
                [error, ...cleanupErrors],
                'Page Manager source commit failed and asset cleanup was incomplete',
            );
        }
        throw error;
    }
}

export async function commitAlbumAssets(
    projectRoot: string,
    albumSlugInput: string,
    assets: Array<{ name: string; bytes: Uint8Array }>,
): Promise<{ copied: string[]; skipped: string[] }> {
    const albumSlug = validateAlbumSlug(albumSlugInput);
    return withAlbumManifestLocks(projectRoot, [albumSlug], async () => {
        await readAlbumManifestFile(projectRoot, albumSlug);
        const mdxPath = path.resolve(projectRoot, 'src/content/albums', `${albumSlug}.mdx`);
        await assertSafeWorkspacePath(projectRoot, mdxPath, 'Album MDX source');
        if (!await pathExists(mdxPath)) throw new Error(`Album source does not exist: ${albumSlug}`);
        return commitAlbumAssetsWithinLock(projectRoot, albumSlug, assets);
    });
}

export async function assertAlbumAssetStorageSafe(
    projectRoot: string,
    albumSlug: string,
): Promise<void> {
    const slug = validateAlbumSlug(albumSlug);
    const directory = path.resolve(projectRoot, 'r2', slug);
    await assertSafeWorkspacePath(projectRoot, directory, 'R2 Album directory');
    try {
        const entries = await readdir(directory, { withFileTypes: true });
        const symlink = entries.find((entry) => entry.isSymbolicLink());
        if (symlink) throw new Error(`R2 Album directory must not contain symlinks: ${symlink.name}`);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
}

export function assertUniqueR2ActionKeys(keys: string[]): void {
    const normalized = keys.map(normalizeAssetKey);
    const seen = new Set<string>();
    for (const key of normalized) {
        if (seen.has(key)) throw new Error(`Duplicate R2 action key: ${key}`);
        seen.add(key);
    }
}

export function nextAlbumOrder(manifests: Record<string, AlbumManifest>, folder: string): number {
    const orders = Object.entries(manifests)
        .filter(([slug]) => slug.startsWith(`${folder}/`))
        .map(([, manifest]) => manifest.order);
    return orders.length === 0 ? 10 : Math.max(...orders) + 10;
}

export async function deleteAlbumSourceFiles(
    projectRoot: string,
    albumSlugInput: string,
    trashSources: (paths: string[]) => Promise<void>,
): Promise<string[]> {
    const albumSlug = validateAlbumSlug(albumSlugInput);
    const initial = await readAllAlbumManifestFiles(projectRoot);
    if (!initial[albumSlug]) throw new Error(`Album manifest not found: ${albumSlug}`);
    return withAlbumManifestLocks(projectRoot, Object.keys(initial), async () => {
        const manifests = await readAllAlbumManifestFiles(projectRoot);
        const consumers = findAlbumDeletionConsumers(manifests, albumSlug);
        if (consumers.length > 0) {
            const blockingKey = Object.entries(manifests)
                .filter(([slug]) => consumers.includes(slug))
                .map(([, manifest]) => manifest.cover.photo)
                .filter((photo): photo is Extract<AlbumManifest['cover']['photo'], { kind: 'external' }> => photo.kind === 'external')
                .map(({ assetKey }) => assetKey)
                .filter((key) => key.startsWith(`${albumSlug}/`))
                .sort()[0];
            throw new AlbumLifecycleConflictError(blockingKey, consumers);
        }
        const candidates = [
            path.resolve(projectRoot, 'src/content/albums', `${albumSlug}.mdx`),
            path.resolve(projectRoot, 'src/album-manifests', `${albumSlug}.json`),
        ];
        const existing: string[] = [];
        for (const candidate of candidates) {
            await assertSafeWorkspacePath(projectRoot, candidate, 'Album deletion source');
            if (await pathExists(candidate)) existing.push(candidate);
        }
        const staged = await Promise.all(existing.map(async (target) => ({
            target,
            staged: path.join(
                path.dirname(target),
                `.${path.basename(target)}.${process.pid}.${randomUUID()}.delete`,
            ),
            bytes: await readFile(target),
            moved: false,
        })));
        try {
            for (const entry of staged) {
                await assertSafeWorkspacePath(projectRoot, entry.target, 'Album deletion source');
                await rename(entry.target, entry.staged);
                entry.moved = true;
            }
        } catch (error) {
            const rollbackErrors: unknown[] = [];
            for (const entry of [...staged].reverse()) {
                if (entry.moved) {
                    await rename(entry.staged, entry.target).catch((failure) => rollbackErrors.push(failure));
                }
            }
            if (rollbackErrors.length > 0) {
                throw new AggregateError([error, ...rollbackErrors], 'Album deletion staging failed and rollback was incomplete');
            }
            throw error;
        }
        try {
            await trashSources(staged.map((entry) => entry.staged));
        } catch (error) {
            const recoveryErrors: unknown[] = [];
            for (const entry of staged) {
                try {
                    if (await pathExists(entry.staged)) await rename(entry.staged, entry.target);
                    else await writeFile(entry.target, entry.bytes, { flag: 'wx' });
                } catch (failure) {
                    recoveryErrors.push(failure);
                }
            }
            if (recoveryErrors.length > 0) {
                throw new AggregateError(
                    [error, ...recoveryErrors],
                    'Album deletion cleanup failed and source recovery was incomplete',
                );
            }
            throw error;
        }
        return existing;
    });
}

export function buildAlbumPageProposal(input: {
    albumSlug: string;
    manifest: AlbumManifest;
    mdx: string;
    importedFilenames: string[];
    metadata?: Pick<AlbumManifest, 'title' | 'info' | 'gap'>;
}): AlbumManifest {
    const albumSlug = validateAlbumSlug(input.albumSlug);
    const current = parseAlbumManifest(input.manifest, albumSlug);
    const imported = new Set(input.importedFilenames.map(validateLocalPhotoFilename));
    const existingByFilename = new Map(current.photos.map((photo) => [photo.filename, photo]));
    const references = extractMdxPhotos(input.mdx);
    const contentFilenames = references.map(({ filename }) => filename);
    for (const filename of contentFilenames) {
        if (!existingByFilename.has(filename) && !imported.has(filename)) {
            throw new Error(`Photo is not tracked or imported: ${filename}`);
        }
    }
    const photos = contentFilenames.map((filename) =>
        existingByFilename.get(filename) ?? { filename, tags: [] }
    );
    if (
        current.cover.photo.kind === 'local' &&
        !contentFilenames.includes(current.cover.photo.filename)
    ) {
        const coverPhoto = existingByFilename.get(current.cover.photo.filename);
        if (!coverPhoto) throw new Error(`Local cover is not tracked: ${current.cover.photo.filename}`);
        photos.push(coverPhoto);
    }
    const proposed = parseAlbumManifest({
        ...current,
        ...(input.metadata ?? {}),
        photos,
    }, albumSlug);
    const diagnostics = validateAlbumInventory({
        albumSlug,
        manifestPath: `src/album-manifests/${albumSlug}.json`,
        manifest: proposed,
        mdxPath: `src/content/albums/${albumSlug}.mdx`,
        mdxBody: input.mdx,
    });
    if (diagnostics.length > 0) {
        throw new Error(`Invalid Page Manager proposal: ${diagnostics.map(({ code }) => code).join(', ')}`);
    }
    return proposed;
}

export function albumPageManagerMetadata(albumSlug: string, manifest: AlbumManifest) {
    const slug = validateAlbumSlug(albumSlug);
    const current = parseAlbumManifest(manifest, slug);
    return {
        title: current.title,
        info: current.info,
        gap: current.gap,
        cover: {
            assetKey: current.cover.photo.kind === 'local'
                ? `${slug}/${current.cover.photo.filename}`
                : current.cover.photo.assetKey,
            zoom: current.cover.zoom,
            offset: current.cover.offset,
        },
    };
}
