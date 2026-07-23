import type { APIRoute } from "astro";

import { parseMountainCoverKey } from "../lib/mountain-schema";
import { readAlbumManifestFile } from "../lib/albums/manifest-files";
import {
    findMountainRegion,
    readMountainRegion,
    writeMountainRegion,
} from "../lib/mountain-files";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return json({ error: "Not available in production" }, 403);
    }

    let body: { mountainName?: string; coverKey?: string };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, 400);
    }

    const mountainName = body.mountainName?.trim();
    const parsedCoverKey = parseMountainCoverKey(body.coverKey);
    if (!mountainName || !parsedCoverKey) {
        return json({ error: "Invalid mountain or cover photo" }, 400);
    }

    const { coverKey, folder, albumId, photoKey } = parsedCoverKey;
    try {
        const [locatedMountain, manifest] = await Promise.all([
            findMountainRegion(mountainName),
            readAlbumManifestFile(process.cwd(), `${folder}/${albumId}`),
        ]);
        if (!locatedMountain) return json({ error: "Mountain not found" }, 404);
        const sourcePhoto = manifest.photos.find((photo) => photo.filename === photoKey);
        if (!sourcePhoto?.tags.some((tag) => tag.name === mountainName)) {
            return json({ error: "Photo does not contain this mountain tag" }, 400);
        }

        const mountains = await readMountainRegion(locatedMountain.region);
        const mountain = mountains.find((entry) => entry.name === mountainName);
        if (!mountain) return json({ error: "Mountain not found" }, 404);
        mountain.coverKey = coverKey;
        await writeMountainRegion(locatedMountain.region, mountains);
        return json({ success: true, coverKey });
    } catch (error) {
        return json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unable to save mountain cover",
            },
            400,
        );
    }
};
// Registered only by the local development server.
