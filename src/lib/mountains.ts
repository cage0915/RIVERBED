import regionData from "../mountain-regions.json";
import { MAP_CONTEXTS } from "./mountain-map.ts";
import type { Mountain } from "./mountain-schema.ts";
import { parseMountainRegionSource } from "./mountain-source.ts";

export type MountainRegionDefinition = {
    id: string;
    label: string;
};

export const MOUNTAIN_REGION_DEFINITIONS =
    regionData as MountainRegionDefinition[];
export const MOUNTAIN_REGIONS = MOUNTAIN_REGION_DEFINITIONS.map(
    (region) => region.id,
);
export type MountainRegion = string;
export type MountainSourceRegion = MountainRegion;

export const MOUNTAIN_REGION_LABELS = Object.fromEntries(
    MOUNTAIN_REGION_DEFINITIONS.map((region) => [region.id, region.label]),
) as Record<MountainSourceRegion, string>;

export type MountainWithRegion = Mountain & {
    region: MountainSourceRegion;
};

const mountainFiles = import.meta.glob("../mountains/*.json", {
    eager: true,
}) as Record<string, { default?: unknown } | unknown>;
const contextIds = new Set(Object.keys(MAP_CONTEXTS));

export const mountainsByRegion = Object.fromEntries(
    MOUNTAIN_REGION_DEFINITIONS.map((region) => {
        const sourcePath = `../mountains/${region.id}.json`;
        const module = mountainFiles[sourcePath];
        if (module === undefined) {
            throw new Error(`Missing Mountain source ${sourcePath}`);
        }
        const input =
            typeof module === "object" &&
            module !== null &&
            "default" in module
                ? module.default
                : module;
        return [
            region.id,
            parseMountainRegionSource(input, sourcePath, contextIds),
        ];
    }),
) as Record<MountainSourceRegion, Mountain[]>;

export const allMountains: MountainWithRegion[] = Object.entries(
    mountainsByRegion,
).flatMap(([region, mountains]) =>
    mountains.map((mountain) => ({
        ...mountain,
        region: region as MountainSourceRegion,
    })),
);

export const findMountain = (name: string) =>
    allMountains.find((mountain) => mountain.name === name);
