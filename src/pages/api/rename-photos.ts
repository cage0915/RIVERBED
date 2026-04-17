import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return new Response(JSON.stringify({ error: 'Not available in production' }), {
            status: 403, headers: { 'Content-Type': 'application/json' },
        });
    }

    const fs = await import('node:fs');
    const path = await import('node:path');

    let body: { albumSlug: string; orderedKeys: string[] };
    try {
        body = await request.json();
    } catch {
        return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400 });
    }

    const { albumSlug, orderedKeys } = body;
    if (!albumSlug || !orderedKeys?.length) {
        return new Response(JSON.stringify({ error: 'Missing albumSlug or orderedKeys' }), { status: 400 });
    }

    const [folder, album] = albumSlug.split('/');
    const r2Dir = path.resolve(process.cwd(), 'r2', folder, album);
    const mdxFile = path.resolve(process.cwd(), 'src/content/albums', `${albumSlug}.mdx`);
    const tagsFile = path.resolve(process.cwd(), 'src/album-tags', folder, `${album}.json`);

    if (!fs.existsSync(r2Dir)) {
        return new Response(JSON.stringify({ error: `r2 folder not found: ${r2Dir}` }), { status: 404 });
    }
    if (!fs.existsSync(mdxFile)) {
        return new Response(JSON.stringify({ error: 'MDX file not found' }), { status: 404 });
    }

    // Build rename map: oldBasename -> newBasename (e.g. "KCS06208.jpg" -> "001.jpg")
    const renameMap = new Map<string, string>();
    orderedKeys.forEach((key, i) => {
        const basename = key.includes('/') ? key.split('/').pop()! : key;
        const ext = path.extname(basename).toLowerCase();
        const newName = `${String(i + 1).padStart(3, '0')}${ext}`;
        renameMap.set(basename, newName);
    });

    // --- Step 1: Rename files in r2 (via temp names to avoid collisions) ---
    const tmpSuffix = `.__tmp_${Date.now()}`;
    const renamedFiles: string[] = [];

    try {
        // Phase A: rename to temp names
        for (const [oldName] of renameMap) {
            const oldPath = path.join(r2Dir, oldName);
            if (fs.existsSync(oldPath)) {
                fs.renameSync(oldPath, oldPath + tmpSuffix);
                renamedFiles.push(oldName);
            }
        }
        // Phase B: rename from temp to final names
        for (const [oldName, newName] of renameMap) {
            const tmpPath = path.join(r2Dir, oldName + tmpSuffix);
            if (fs.existsSync(tmpPath)) {
                fs.renameSync(tmpPath, path.join(r2Dir, newName));
            }
        }
    } catch (err: any) {
        // Attempt rollback
        for (const oldName of renamedFiles) {
            const tmpPath = path.join(r2Dir, oldName + tmpSuffix);
            if (fs.existsSync(tmpPath)) {
                try { fs.renameSync(tmpPath, path.join(r2Dir, oldName)); } catch {}
            }
        }
        return new Response(JSON.stringify({ error: `File rename failed: ${err.message}` }), { status: 500 });
    }

    // --- Step 2: Update MDX (itemKey and coverKey references) ---
    let mdxContent = fs.readFileSync(mdxFile, 'utf-8');
    // Single-pass replacement to avoid chained substitution (e.g. 002→001 then 001→002 = both become 002)
    const escapedKeys = [...renameMap.keys()].map(k => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const mdxPattern = new RegExp(`"(${escapedKeys.join('|')})"`, 'g');
    mdxContent = mdxContent.replace(mdxPattern, (_, name) => `"${renameMap.get(name) ?? name}"`);
    fs.writeFileSync(mdxFile, mdxContent, 'utf-8');

    // --- Step 3: Update album-tags JSON (rename keys, keep values) ---
    if (fs.existsSync(tagsFile)) {
        const tagsRaw = fs.readFileSync(tagsFile, 'utf-8');
        let tags: Record<string, any> = {};
        try { tags = JSON.parse(tagsRaw); } catch {}

        const newTags: Record<string, any> = {};
        for (const [key, value] of Object.entries(tags)) {
            const basename = key.includes('/') ? key.split('/').pop()! : key;
            const mapped = renameMap.get(basename) ?? basename;
            newTags[mapped] = value;
        }
        fs.writeFileSync(tagsFile, JSON.stringify(newTags, null, 2), 'utf-8');
    }

    return new Response(JSON.stringify({ ok: true, renamed: Object.fromEntries(renameMap) }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
    });
};
