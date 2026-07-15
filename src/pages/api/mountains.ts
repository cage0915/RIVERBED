import type { APIRoute } from "astro";

import { sanitizeMountainEntry } from "../../lib/mountain-editor";
import {
    isMountainSourceRegion,
    readAllMountainRegions,
    readMountainRegion,
    writeMountainRegion,
} from "../../lib/mountain-files";
import {
    MOUNTAIN_REGION_DEFINITIONS,
    type MountainSourceRegion,
} from "../../lib/mountains";
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

export const GET: APIRoute = async () => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);

    const path = await import("node:path");
    const contextsFile = path.resolve(process.cwd(), "src/map-contexts.json");
    const [mountains, mapConfig] = await Promise.all([
        readAllMountainRegions(),
        readJson<{
            contexts: Record<string, unknown>;
        }>(contextsFile),
    ]);

    return json({
        mountains,
        regions: MOUNTAIN_REGION_DEFINITIONS,
        contexts: mapConfig.contexts,
        sources: MAP_SOURCES,
    });
};

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);

    let body: {
        originalName?: string;
        region?: MountainSourceRegion;
        mountain?: unknown;
    };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, 400);
    }

    const originalName = body.originalName?.trim();
    if (!originalName || !body.mountain || !isMountainSourceRegion(body.region)) {
        return json({ error: "Missing mountain data" }, 400);
    }

    const path = await import("node:path");
    const contextsFile = path.resolve(process.cwd(), "src/map-contexts.json");

    try {
        const [mountains, mapConfig] = await Promise.all([
            readMountainRegion(body.region),
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
        await writeMountainRegion(body.region, mountains);
        return json({ success: true, mountain: { ...mountain, region: body.region } });
    } catch (error) {
        return json(
            { error: error instanceof Error ? error.message : "Unable to save mountain" },
            400,
        );
    }
};
