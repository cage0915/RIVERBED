import type { MapBounds } from "./mountain-map.ts";
import { isValidMapBounds } from "./mountain-map.ts";
import type { PeakFinderPanorama } from "./mountain-panorama.ts";

export type MountainDataSource = {
    wikidataId?: string;
};

export type EditableMountain = {
    name: string;
    elevation: number | null;
    description: string;
    location?: {
        latitude: number;
        longitude: number;
        mapContext: string;
        initialBounds?: MapBounds;
    };
    panorama?: PeakFinderPanorama;
    dataSource?: MountainDataSource;
};

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
        if (!result.location) throw new Error("Panorama requires a mountain location");
        if (typeof candidate.panorama !== "object") {
            throw new Error("Invalid panorama settings");
        }
        const panorama = candidate.panorama as Record<string, unknown>;
        if (panorama.provider !== "peakfinder") {
            throw new Error("Unsupported panorama provider");
        }

        result.panorama = { provider: "peakfinder" };
        const azimuth = optionalNumber(panorama.azimuth, 0, 360);
        const altitude = optionalNumber(panorama.altitude, -25, 25);
        const fieldOfView = optionalNumber(panorama.fieldOfView, 8, 90);
        if (azimuth !== undefined) result.panorama.azimuth = azimuth;
        if (altitude !== undefined) result.panorama.altitude = altitude;
        if (fieldOfView !== undefined) result.panorama.fieldOfView = fieldOfView;
    }

    if (candidate.dataSource !== undefined && candidate.dataSource !== null) {
        if (typeof candidate.dataSource !== "object") {
            throw new Error("Invalid data source metadata");
        }
        const source = candidate.dataSource as Record<string, unknown>;
        const wikidataId =
            typeof source.wikidataId === "string" ? source.wikidataId.trim() : "";
        if (wikidataId && !/^Q\d+$/.test(wikidataId)) {
            throw new Error("Invalid Wikidata ID");
        }
        if (wikidataId) result.dataSource = { wikidataId };
    }

    return result;
}
