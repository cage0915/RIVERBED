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
import {
    mountainContourFileExists,
    regenerateMountainContour,
} from "../../lib/mountain-contour-files";

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

type MountainChangeRequest = {
    originalName?: string;
    region?: MountainSourceRegion;
    mountain?: unknown;
    forceContour?: boolean;
};

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);

    let body: MountainChangeRequest & { changes?: MountainChangeRequest[] };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, 400);
    }

    const changes = Array.isArray(body.changes) ? body.changes : [body];
    if (!changes.length) {
        return json({ error: "Missing mountain data" }, 400);
    }

    const path = await import("node:path");
    const contextsFile = path.resolve(process.cwd(), "src/map-contexts.json");

    try {
        const mapConfig = await readJson<{ contexts: Record<string, unknown> }>(
            contextsFile,
        );
        const validContexts = new Set(Object.keys(mapConfig.contexts));
        const regionMountains = new Map<MountainSourceRegion, Awaited<ReturnType<typeof readMountainRegion>>>();
        const originalRegions = new Map<MountainSourceRegion, Awaited<ReturnType<typeof readMountainRegion>>>();
        const changedRegions = new Set<MountainSourceRegion>();
        const contourJobs: Array<{ region: MountainSourceRegion; name: string }> = [];
        const savedMountains = [];
        const seen = new Set<string>();

        for (const change of changes) {
            const originalName = change.originalName?.trim();
            if (
                !originalName ||
                !change.mountain ||
                !isMountainSourceRegion(change.region)
            ) {
                return json({ error: "Missing mountain data" }, 400);
            }
            const key = `${change.region}\u0000${originalName}`;
            if (seen.has(key)) return json({ error: "Duplicate mountain change" }, 400);
            seen.add(key);

            let mountains = regionMountains.get(change.region);
            if (!mountains) {
                mountains = await readMountainRegion(change.region);
                regionMountains.set(change.region, mountains);
                originalRegions.set(change.region, structuredClone(mountains));
            }
            const mountain = sanitizeMountainEntry(change.mountain, validContexts);
            if (mountain.name !== originalName) {
                return json({ error: "Renaming mountains is not supported yet" }, 400);
            }
            const index = mountains.findIndex((entry) => entry.name === originalName);
            if (index < 0) return json({ error: "Mountain not found" }, 404);
            const previousMountain = mountains[index];
            const mountainChanged =
                JSON.stringify(previousMountain) !== JSON.stringify(mountain);
            const coordinatesChanged =
                previousMountain.location?.latitude !== mountain.location?.latitude ||
                previousMountain.location?.longitude !== mountain.location?.longitude;
            const hasCoordinates =
                Number.isFinite(mountain.location?.latitude) &&
                Number.isFinite(mountain.location?.longitude);
            const contourMissing = hasCoordinates
                ? !(await mountainContourFileExists(change.region, mountain.name))
                : false;

            mountains[index] = mountain;
            if (mountainChanged) changedRegions.add(change.region);
            if (
                hasCoordinates &&
                (change.forceContour === true || coordinatesChanged || contourMissing)
            ) {
                contourJobs.push({ region: change.region, name: mountain.name });
            }
            savedMountains.push({ ...mountain, region: change.region });
        }

        try {
            await Promise.all(
                [...changedRegions].map((region) =>
                    writeMountainRegion(region, regionMountains.get(region)!),
                ),
            );
            for (const job of contourJobs) {
                await regenerateMountainContour(job.region, job.name);
            }
        } catch (error) {
            await Promise.all(
                [...changedRegions].map((region) =>
                    writeMountainRegion(region, originalRegions.get(region)!),
                ),
            );
            throw error;
        }

        if (!Array.isArray(body.changes)) {
            return json({
                success: true,
                mountain: savedMountains[0],
                contourGenerated: contourJobs.length > 0,
            });
        }
        return json({
            success: true,
            mountains: savedMountains,
            contoursGenerated: contourJobs.length,
        });
    } catch (error) {
        return json(
            { error: error instanceof Error ? error.message : "Unable to save mountain" },
            400,
        );
    }
};
