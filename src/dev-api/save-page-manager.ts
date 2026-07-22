import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import trash from 'trash';

import { validateImageFilename } from '../lib/album-import.js';
import { createPageContent, referencedLocalNames } from '../lib/page-structure';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});
const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: 'Not available in production' }, 403);
    try {
        const form = await request.formData();
        const albumSlug = String(form.get('albumSlug') || '');
        if (!/^[a-z0-9-]+\/[a-z0-9-]+$/.test(albumSlug)) return json({ error: 'Invalid albumSlug' }, 400);
        const draft = JSON.parse(String(form.get('draft') || '{}')) as {
            blocks?: any[];
            frontmatter?: string;
            removeLocal?: string[];
        };
        if (!Array.isArray(draft.blocks)) return json({ error: 'Invalid page draft' }, 400);

        const projectRoot = process.cwd();
        const albumDirectory = path.resolve(projectRoot, 'r2', albumSlug);
        const allowedRoot = path.resolve(projectRoot, 'r2') + path.sep;
        const mdxPath = path.resolve(projectRoot, 'src/content/albums', `${albumSlug}.mdx`);
        if (!albumDirectory.startsWith(allowedRoot) || !fs.existsSync(mdxPath)) return json({ error: 'Page does not exist' }, 404);

        const files = form.getAll('photos').filter((entry): entry is File => typeof entry !== 'string');
        const names = files.map((file) => validateImageFilename(file.name));
        if (new Set(names).size !== names.length) return json({ error: 'Duplicate import filenames' }, 409);
        const removals = (draft.removeLocal || []).map(validateImageFilename);
        if (new Set(removals).size !== removals.length) return json({ error: 'Duplicate local removals' }, 400);
        if (names.some((name) => removals.includes(name))) return json({ error: 'A photo cannot be imported and removed together' }, 409);

        const referenced = referencedLocalNames(draft.blocks, draft.frontmatter || '');
        const protectedRemoval = removals.find((name) => referenced.has(name));
        if (protectedRemoval) return json({ error: `${protectedRemoval} is still referenced by the page draft` }, 409);

        const payloads = await Promise.all(files.map(async (file, index) => ({
            name: names[index],
            bytes: new Uint8Array(await file.arrayBuffer()),
        })));
        for (const payload of payloads) {
            const target = path.join(albumDirectory, payload.name);
            if (!fs.existsSync(target)) continue;
            if (digest(fs.readFileSync(target)) !== digest(payload.bytes)) {
                return json({ error: `Different local photo already uses ${payload.name}` }, 409);
            }
        }
        for (const name of removals) {
            if (!fs.existsSync(path.join(albumDirectory, name))) return json({ error: `Local photo no longer exists: ${name}` }, 409);
        }

        const originalContent = fs.readFileSync(mdxPath, 'utf8');
        const newContent = createPageContent(originalContent, draft.blocks, draft.frontmatter);
        fs.mkdirSync(albumDirectory, { recursive: true });
        const copied: string[] = [];
        for (const payload of payloads) {
            const target = path.join(albumDirectory, payload.name);
            if (fs.existsSync(target)) continue;
            fs.writeFileSync(target, payload.bytes);
            copied.push(payload.name);
        }

        const temporaryMdx = `${mdxPath}.${process.pid}.tmp`;
        fs.writeFileSync(temporaryMdx, newContent, 'utf8');
        fs.renameSync(temporaryMdx, mdxPath);

        const removed: string[] = [];
        if (removals.length) {
            await trash(removals.map((name) => path.join(albumDirectory, name)), { glob: false });
            removed.push(...removals);
        }

        return json({ success: true, copied, removed });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'Page Manager save failed' }, 400);
    }
};
// Registered only by the local development server.
