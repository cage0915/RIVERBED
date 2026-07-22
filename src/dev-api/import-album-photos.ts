import type { APIRoute } from 'astro';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { createAlbumMdx, validateAlbumSegment, validateImageFilename } from '../lib/album-import.js';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
});

const digest = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

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
        if (!albumDir.startsWith(allowedAlbumRoot)) return json({ error: 'Invalid target path' }, 400);
        if (createPage && fs.existsSync(mdxPath)) return json({ error: 'Page already exists' }, 409);
        if (!createPage && !fs.existsSync(mdxPath)) return json({ error: 'Page does not exist' }, 404);

        const payloads = await Promise.all(files.map(async (file, index) => ({
            name: names[index],
            bytes: new Uint8Array(await file.arrayBuffer()),
        })));

        const conflicts: string[] = [];
        const skipped: string[] = [];
        for (const payload of payloads) {
            const target = path.join(albumDir, payload.name);
            if (!fs.existsSync(target)) continue;
            const current = fs.readFileSync(target);
            if (digest(current) === digest(payload.bytes)) skipped.push(payload.name);
            else conflicts.push(payload.name);
        }
        if (conflicts.length > 0) return json({ error: 'Different files already use these names', conflicts }, 409);

        fs.mkdirSync(albumDir, { recursive: true });
        const copied: string[] = [];
        for (const payload of payloads) {
            if (skipped.includes(payload.name)) continue;
            fs.writeFileSync(path.join(albumDir, payload.name), payload.bytes);
            copied.push(payload.name);
        }

        if (createPage) {
            fs.mkdirSync(path.dirname(mdxPath), { recursive: true });
            fs.writeFileSync(mdxPath, createAlbumMdx({ title, filenames: names }), 'utf8');
            const orderPath = path.join(path.dirname(mdxPath), '_order.json');
            let order: string[] = [];
            if (fs.existsSync(orderPath)) {
                try {
                    const parsed = JSON.parse(fs.readFileSync(orderPath, 'utf8'));
                    if (Array.isArray(parsed)) order = parsed.filter((item): item is string => typeof item === 'string');
                } catch {}
            }
            if (!order.includes(album)) order.unshift(album);
            fs.writeFileSync(orderPath, JSON.stringify(order, null, 4), 'utf8');
        }

        return json({
            success: true,
            copied,
            skipped,
            redirectUrl: `/${folder}/${album}`,
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Import failed';
        return json({ error: message }, 400);
    }
};
// Registered only by the local development server.
