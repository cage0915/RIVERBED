import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';

export const GET: APIRoute = async () => {
    const cwd = process.cwd();

    // --- Read mountains.json ---
    interface MountainEntry {
        name: string;
        elevation: number | null;
        description: string;
    }

    const mountainsFile = path.resolve(cwd, 'src/mountains.json');
    let mountains: MountainEntry[] = [];
    if (fs.existsSync(mountainsFile)) {
        try {
            mountains = JSON.parse(fs.readFileSync(mountainsFile, 'utf-8'));
        } catch {
            mountains = [];
        }
    }


    // --- Read all album-tags JSONs ---
    const tagsRoot = path.resolve(cwd, 'src/album-tags');
    const allTags: Record<string, Record<string, { name: string; x: number; y: number }[]>> = {};

    if (fs.existsSync(tagsRoot)) {
        for (const folder of fs.readdirSync(tagsRoot)) {
            const folderPath = path.join(tagsRoot, folder);
            if (!fs.statSync(folderPath).isDirectory()) continue;

            for (const file of fs.readdirSync(folderPath)) {
                if (!file.endsWith('.json')) continue;
                const album = file.replace('.json', '');
                const filePath = path.join(folderPath, file);
                try {
                    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                    allTags[`${folder}/${album}`] = data;
                } catch {
                    // skip corrupt files
                }
            }
        }
    }

    return new Response(
        JSON.stringify({ mountains, allTags }),
        {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }
    );
};
