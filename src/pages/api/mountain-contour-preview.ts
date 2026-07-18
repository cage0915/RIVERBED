import type { APIRoute } from "astro";

import { generateMountainContourPreview } from "../../lib/mountain-contour-files";
import {
    isMountainSourceRegion,
    readMountainRegion,
} from "../../lib/mountain-files";

const jsonError = (error: string, status: number) =>
    new Response(JSON.stringify({ error }), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return jsonError("Not available in production", 403);

    let body: {
        region?: unknown;
        name?: unknown;
        latitude?: unknown;
        longitude?: unknown;
    };
    try {
        body = await request.json();
    } catch {
        return jsonError("Invalid JSON body", 400);
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (
        !name ||
        !isMountainSourceRegion(body.region) ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude) ||
        latitude < -90 ||
        latitude > 90 ||
        longitude < -180 ||
        longitude > 180
    ) {
        return jsonError("Invalid mountain or coordinates", 400);
    }

    try {
        const mountains = await readMountainRegion(body.region);
        if (!mountains.some((mountain) => mountain.name === name)) {
            return jsonError("Mountain not found", 404);
        }
        const svg = await generateMountainContourPreview(body.region, name, {
            latitude,
            longitude,
        });
        return new Response(svg, {
            headers: {
                "Content-Type": "image/svg+xml; charset=utf-8",
                "Cache-Control": "no-store",
            },
        });
    } catch (error) {
        return jsonError(
            error instanceof Error ? error.message : "Unable to generate contour preview",
            400,
        );
    }
};
