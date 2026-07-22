import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

type RenameStatus = 'rename' | 'unchanged' | 'missing' | 'conflict' | 'duplicate';
type RenameItem = { oldName: string; newName: string; status: RenameStatus };

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const buildPlan = (r2Dir: string, orderedKeys: string[]): RenameItem[] => {
    const sourceNames = orderedKeys.map((key) => key.split('/').pop() || key);
    const sourceSet = new Set(sourceNames);
    const seen = new Set<string>();

    return sourceNames.map((oldName, index) => {
        const extension = path.extname(oldName).toLowerCase();
        const newName = `${String(index + 1).padStart(3, '0')}${extension}`;
        if (seen.has(oldName)) return { oldName, newName, status: 'duplicate' };
        seen.add(oldName);
        if (!fs.existsSync(path.join(r2Dir, oldName))) return { oldName, newName, status: 'missing' };
        if (oldName === newName) return { oldName, newName, status: 'unchanged' };
        if (fs.existsSync(path.join(r2Dir, newName)) && !sourceSet.has(newName)) {
            return { oldName, newName, status: 'conflict' };
        }
        return { oldName, newName, status: 'rename' };
    });
};

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);

    let body: { albumSlug?: string; orderedKeys?: string[]; dryRun?: boolean };
    try {
        body = await request.json();
    } catch {
        return json({ error: 'Invalid JSON' }, 400);
    }

    const albumSlug = body.albumSlug || '';
    const orderedKeys = body.orderedKeys;
    if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(albumSlug) || !Array.isArray(orderedKeys) || orderedKeys.length === 0) {
        return json({ error: 'Missing or invalid albumSlug or orderedKeys' }, 400);
    }
    if (orderedKeys.length > 10000 || orderedKeys.some((key) => typeof key !== 'string' || !/\.(?:jpe?g|png|webp|avif)$/i.test(key))) {
        return json({ error: 'Invalid photo keys' }, 400);
    }

    const [folder, album] = albumSlug.split('/');
    const r2Dir = path.resolve(process.cwd(), 'r2', folder, album);
    const mdxFile = path.resolve(process.cwd(), 'src/content/albums', `${albumSlug}.mdx`);
    const tagsFile = path.resolve(process.cwd(), 'src/album-tags', folder, `${album}.json`);
    if (!fs.existsSync(r2Dir)) return json({ error: `r2 folder not found: ${r2Dir}` }, 404);
    if (!fs.existsSync(mdxFile)) return json({ error: 'MDX file not found' }, 404);

    const plan = buildPlan(r2Dir, orderedKeys);
    const blocking = plan.filter((item) => ['missing', 'conflict', 'duplicate'].includes(item.status));
    const renameItems = plan.filter((item) => item.status === 'rename');
    if (body.dryRun) {
        return json({
            dryRun: true,
            items: plan,
            renameCount: renameItems.length,
            unchangedCount: plan.filter((item) => item.status === 'unchanged').length,
            canExecute: blocking.length === 0 && renameItems.length > 0,
        });
    }
    if (blocking.length > 0) return json({ error: 'Rename plan contains blocking issues', items: plan }, 409);
    if (renameItems.length === 0) return json({ ok: true, renamed: {} });

    const renameMap = new Map(renameItems.map((item) => [item.oldName, item.newName]));
    const tmpSuffix = `.__tmp_${Date.now()}`;
    const stagedFiles: string[] = [];

    try {
        for (const oldName of renameMap.keys()) {
            const oldPath = path.join(r2Dir, oldName);
            fs.renameSync(oldPath, oldPath + tmpSuffix);
            stagedFiles.push(oldName);
        }
        for (const [oldName, newName] of renameMap) {
            fs.renameSync(path.join(r2Dir, oldName + tmpSuffix), path.join(r2Dir, newName));
        }
    } catch (error) {
        for (const oldName of stagedFiles) {
            const temporaryPath = path.join(r2Dir, oldName + tmpSuffix);
            if (fs.existsSync(temporaryPath)) {
                try { fs.renameSync(temporaryPath, path.join(r2Dir, oldName)); } catch {}
            }
        }
        return json({ error: `File rename failed: ${error instanceof Error ? error.message : 'Unknown error'}` }, 500);
    }

    let mdxContent = fs.readFileSync(mdxFile, 'utf8');
    const escapedKeys = [...renameMap.keys()].map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mdxPattern = new RegExp(`"(${escapedKeys.join('|')})"`, 'g');
    mdxContent = mdxContent.replace(mdxPattern, (_, name) => `"${renameMap.get(name) ?? name}"`);
    fs.writeFileSync(mdxFile, mdxContent, 'utf8');

    if (fs.existsSync(tagsFile)) {
        let tags: Record<string, unknown> = {};
        try { tags = JSON.parse(fs.readFileSync(tagsFile, 'utf8')); } catch {}
        const nextTags: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(tags)) {
            const name = key.split('/').pop() || key;
            nextTags[renameMap.get(name) ?? name] = value;
        }
        fs.writeFileSync(tagsFile, JSON.stringify(nextTags, null, 2), 'utf8');
    }

    return json({ ok: true, renamed: Object.fromEntries(renameMap) });
};
// Registered only by the local development server.
