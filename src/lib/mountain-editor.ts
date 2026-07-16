import type { MapBounds } from "./mountain-map.ts";
import { isValidMapBounds } from "./mountain-map.ts";

export type EditableMountain = {
    name: string;
    elevation: number | null;
    description: string;
    coverKey?: string;
    location?: {
        latitude: number;
        longitude: number;
        mapContext: string;
        initialBounds?: MapBounds;
    };
    panorama?: boolean;
};

export type MountainCoverKey = {
    coverKey: string;
    folder: string;
    albumId: string;
    photoKey: string;
};

export function parseMountainCoverKey(input: unknown): MountainCoverKey | null {
    if (typeof input !== "string") return null;

    const coverKey = input.trim();
    const match = coverKey.match(
        /^([a-z0-9][a-z0-9-]*)\/([a-z0-9][a-z0-9-]*)\/([^/]+)$/i,
    );
    if (!match || match[3] === "." || match[3] === "..") return null;

    return {
        coverKey,
        folder: match[1],
        albumId: match[2],
        photoKey: match[3],
    };
}

const optionalNumber = (
    value: unknown,
    minimum: number,
    maximum: number,
): number | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    const number = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(number) || number < minimum || number > maximum) {
        throw new Error(`Number must be between ${minimum} and ${maximum}`);
    }
    return number;
};

export function sanitizeMountainEntry(
    input: unknown,
    contextIds: ReadonlySet<string>,
): EditableMountain {
    if (!input || typeof input !== "object") {
        throw new Error("Invalid mountain entry");
    }

    const candidate = input as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name || name.length > 120) throw new Error("Invalid mountain name");

    const description =
        typeof candidate.description === "string" ? candidate.description.trim() : "";
    if (description.length > 5000) throw new Error("Description is too long");

    let elevation: number | null = null;
    if (candidate.elevation !== null && candidate.elevation !== undefined && candidate.elevation !== "") {
        elevation = optionalNumber(candidate.elevation, -500, 9000) ?? null;
    }

    const result: EditableMountain = { name, elevation, description };

    if (candidate.coverKey !== undefined && candidate.coverKey !== null) {
        const parsedCoverKey = parseMountainCoverKey(candidate.coverKey);
        if (!parsedCoverKey) {
            throw new Error("Invalid mountain cover key");
        }
        result.coverKey = parsedCoverKey.coverKey;
    }

    if (candidate.location !== undefined && candidate.location !== null) {
        if (typeof candidate.location !== "object") {
            throw new Error("Invalid mountain location");
        }
        const location = candidate.location as Record<string, unknown>;
        const latitude = optionalNumber(location.latitude, -90, 90);
        const longitude = optionalNumber(location.longitude, -180, 180);
        const mapContext =
            typeof location.mapContext === "string" ? location.mapContext.trim() : "";

        if (latitude === undefined || longitude === undefined) {
            throw new Error("Latitude and longitude are required together");
        }
        if (!contextIds.has(mapContext)) throw new Error("Unknown map context");

        result.location = { latitude, longitude, mapContext };
        if (location.initialBounds !== undefined) {
            if (!isValidMapBounds(location.initialBounds)) {
                throw new Error("Invalid initial map bounds");
            }
            result.location.initialBounds = {
                west: Number(location.initialBounds.west.toFixed(6)),
                south: Number(location.initialBounds.south.toFixed(6)),
                east: Number(location.initialBounds.east.toFixed(6)),
                north: Number(location.initialBounds.north.toFixed(6)),
            };
        }
    }

    if (candidate.panorama !== undefined && candidate.panorama !== null) {
        if (typeof candidate.panorama !== "boolean") {
            throw new Error("Invalid panorama settings");
        }
        if (candidate.panorama && !result.location) {
            throw new Error("Panorama requires a mountain location");
        }
        result.panorama = candidate.panorama;
    }

    return result;
}
