import { isValidMapBounds, type MapBounds } from "./mountain-map.ts";

export type MountainLocation = {
    latitude: number;
    longitude: number;
    mapContext: string;
    initialBounds?: MapBounds;
};

export type Mountain = {
    name: string;
    alternateName?: string;
    elevation: number | null;
    description: string;
    coverKey?: string;
    location?: MountainLocation;
    panorama?: boolean;
};

export type MountainCoverKey = {
    coverKey: string;
    folder: string;
    albumId: string;
    photoKey: string;
};

const ROOT_FIELDS = [
    "name",
    "alternateName",
    "elevation",
    "description",
    "coverKey",
    "location",
    "panorama",
] as const;
const LOCATION_FIELDS = [
    "latitude",
    "longitude",
    "mapContext",
    "initialBounds",
] as const;
const BOUNDS_FIELDS = ["west", "south", "east", "north"] as const;

function requireRecord(
    value: unknown,
    field: string,
): Record<string, unknown> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new Error(`${field} must be an object`);
    }
    return value as Record<string, unknown>;
}

function rejectUnknownFields(
    value: Record<string, unknown>,
    allowed: readonly string[],
    field: string,
): void {
    const allowedFields = new Set(allowed);
    const unknown = Object.keys(value).find((key) => !allowedFields.has(key));
    if (unknown !== undefined) {
        throw new Error(`${field} has unknown field ${unknown}`);
    }
}

function requireCanonicalString(
    value: unknown,
    field: string,
    maximumLength: number,
    allowEmpty: boolean,
): string {
    if (typeof value !== "string") {
        throw new Error(`${field} must be a string`);
    }
    if (value !== value.trim()) {
        throw new Error(`${field} must not have leading or trailing whitespace`);
    }
    if ((!allowEmpty && value.length === 0) || value.length > maximumLength) {
        throw new Error(
            `${field} must ${allowEmpty ? "be at most" : "contain 1 to"} ${maximumLength} characters`,
        );
    }
    return value;
}

function requireFiniteNumber(
    value: unknown,
    field: string,
    minimum: number,
    maximum: number,
): number {
    if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value < minimum ||
        value > maximum
    ) {
        throw new Error(`${field} must be a finite number from ${minimum} through ${maximum}`);
    }
    return value;
}

function parseInitialBounds(value: unknown): MapBounds {
    const bounds = requireRecord(value, "initialBounds");
    rejectUnknownFields(bounds, BOUNDS_FIELDS, "initialBounds");
    const parsed = {
        west: requireFiniteNumber(bounds.west, "initialBounds.west", -180, 180),
        south: requireFiniteNumber(bounds.south, "initialBounds.south", -90, 90),
        east: requireFiniteNumber(bounds.east, "initialBounds.east", -180, 180),
        north: requireFiniteNumber(bounds.north, "initialBounds.north", -90, 90),
    };
    if (!isValidMapBounds(parsed)) {
        throw new Error("initialBounds must describe valid geographic bounds");
    }
    return parsed;
}

function parseLocation(
    value: unknown,
    contextIds: ReadonlySet<string>,
): MountainLocation {
    const location = requireRecord(value, "location");
    rejectUnknownFields(location, LOCATION_FIELDS, "location");
    const mapContext = requireCanonicalString(
        location.mapContext,
        "location.mapContext",
        64,
        false,
    );
    if (!contextIds.has(mapContext)) {
        throw new Error(`location.mapContext is unknown: ${mapContext}`);
    }
    return {
        latitude: requireFiniteNumber(
            location.latitude,
            "location.latitude",
            -90,
            90,
        ),
        longitude: requireFiniteNumber(
            location.longitude,
            "location.longitude",
            -180,
            180,
        ),
        mapContext,
        ...(location.initialBounds === undefined
            ? {}
            : { initialBounds: parseInitialBounds(location.initialBounds) }),
    };
}

export function parseMountainCoverKey(
    input: unknown,
): MountainCoverKey | null {
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

export function parseMountain(
    input: unknown,
    contextIds: ReadonlySet<string>,
): Mountain {
    const candidate = requireRecord(input, "Mountain");
    rejectUnknownFields(candidate, ROOT_FIELDS, "Mountain");

    let elevation: number | null;
    if (candidate.elevation === null) {
        elevation = null;
    } else {
        elevation = requireFiniteNumber(
            candidate.elevation,
            "elevation",
            -500,
            9000,
        );
        if (!Number.isInteger(elevation)) {
            throw new Error("elevation must be an integer");
        }
    }

    const result: Mountain = {
        name: requireCanonicalString(candidate.name, "name", 120, false),
        elevation,
        description: requireCanonicalString(
            candidate.description,
            "description",
            5000,
            true,
        ),
    };

    if (candidate.alternateName !== undefined) {
        result.alternateName = requireCanonicalString(
            candidate.alternateName,
            "alternateName",
            200,
            false,
        );
    }
    if (candidate.coverKey !== undefined) {
        const parsedCoverKey = parseMountainCoverKey(candidate.coverKey);
        if (
            parsedCoverKey === null ||
            parsedCoverKey.coverKey !== candidate.coverKey
        ) {
            throw new Error("coverKey must be a canonical Mountain cover key");
        }
        result.coverKey = parsedCoverKey.coverKey;
    }
    if (candidate.location !== undefined) {
        result.location = parseLocation(candidate.location, contextIds);
    }
    if (candidate.panorama !== undefined) {
        if (typeof candidate.panorama !== "boolean") {
            throw new Error("panorama must be a boolean");
        }
        result.panorama = candidate.panorama;
    }

    return result;
}

export function parseMountainArray(
    input: unknown,
    contextIds: ReadonlySet<string>,
): Mountain[] {
    if (!Array.isArray(input)) {
        throw new Error("Mountain source must be an array");
    }
    return input.map((entry, index) => {
        try {
            return parseMountain(entry, contextIds);
        } catch (cause) {
            const message = cause instanceof Error ? cause.message : String(cause);
            throw new Error(`Mountain entry ${index}: ${message}`, { cause });
        }
    });
}
