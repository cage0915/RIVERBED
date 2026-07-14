import type { APIRoute } from "astro";

import { sanitizeMountainEntry, type EditableMountain } from "../../lib/mountain-editor";
import { MAP_SOURCES } from "../../lib/mountain-map";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });

const readJson = async <T>(file: string): Promise<T> => {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
};

const writeJson = async (file: string, value: unknown) => {
    const fs = await import("node:fs/promises");
    const temporaryFile = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, file);
};

export const GET: APIRoute = async () => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);

    const path = await import("node:path");
    const mountainsFile = path.resolve(process.cwd(), "src/mountains.json");
    const contextsFile = path.resolve(process.cwd(), "src/map-contexts.json");
    const [mountains, mapConfig] = await Promise.all([
        readJson<EditableMountain[]>(mountainsFile),
        readJson<{
            contexts: Record<string, unknown>;
        }>(contextsFile),
    ]);

    return json({
        mountains,
        contexts: mapConfig.contexts,
        sources: MAP_SOURCES,
    });
};

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);

    let body: { originalName?: string; mountain?: unknown };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, 400);
    }

    const originalName = body.originalName?.trim();
    if (!originalName || !body.mountain) {
        return json({ error: "Missing mountain data" }, 400);
    }

    const path = await import("node:path");
    const mountainsFile = path.resolve(process.cwd(), "src/mountains.json");
    const contextsFile = path.resolve(process.cwd(), "src/map-contexts.json");

    try {
        const [mountains, mapConfig] = await Promise.all([
            readJson<EditableMountain[]>(mountainsFile),
            readJson<{ contexts: Record<string, unknown> }>(contextsFile),
        ]);
        const mountain = sanitizeMountainEntry(
            body.mountain,
            new Set(Object.keys(mapConfig.contexts)),
        );
        if (mountain.name !== originalName) {
            return json({ error: "Renaming mountains is not supported yet" }, 400);
        }

        const index = mountains.findIndex((entry) => entry.name === originalName);
        if (index < 0) return json({ error: "Mountain not found" }, 404);
        mountains[index] = mountain;
        await writeJson(mountainsFile, mountains);
        return json({ success: true, mountain });
    } catch (error) {
        return json(
            { error: error instanceof Error ? error.message : "Unable to save mountain" },
            400,
        );
    }
};
