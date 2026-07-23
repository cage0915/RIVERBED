import { isValidMapBounds } from "./mountain-map.ts";
import {
    parseMountain,
    parseMountainCoverKey,
    type Mountain,
} from "./mountain-schema.ts";

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

const roundTo = (value: number, decimalPlaces: number) => {
    const factor = 10 ** decimalPlaces;
    return (
        Math.sign(value) *
        Math.round((Math.abs(value) + Number.EPSILON) * factor) /
        factor
    );
};

export function sanitizeMountainEntry(
    input: unknown,
    contextIds: ReadonlySet<string>,
): Mountain {
    if (!input || typeof input !== "object") {
        throw new Error("Invalid mountain entry");
    }

    const candidate = input as Record<string, unknown>;
    const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
    if (!name || name.length > 120) throw new Error("Invalid mountain name");

    const description =
        typeof candidate.description === "string" ? candidate.description.trim() : "";
    if (description.length > 5000) throw new Error("Description is too long");

    const alternateName =
        typeof candidate.alternateName === "string"
            ? candidate.alternateName.trim()
            : "";
    if (alternateName.length > 200) {
        throw new Error("Alternate mountain name is too long");
    }

    let elevation: number | null = null;
    if (candidate.elevation !== null && candidate.elevation !== undefined && candidate.elevation !== "") {
        const parsedElevation = optionalNumber(candidate.elevation, -500, 9000);
        elevation = parsedElevation === undefined ? null : roundTo(parsedElevation, 0);
    }

    const result: Mountain = {
        name,
        ...(alternateName ? { alternateName } : {}),
        elevation,
        description,
    };

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

        result.location = {
            latitude: roundTo(latitude, 6),
            longitude: roundTo(longitude, 6),
            mapContext,
        };
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
        result.panorama = candidate.panorama;
    }

    return parseMountain(result, contextIds);
}
