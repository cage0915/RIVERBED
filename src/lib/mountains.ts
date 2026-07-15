import type { EditableMountain } from "./mountain-editor";
import regionData from "../mountain-regions.json";

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

export type MountainWithRegion = EditableMountain & {
    region: MountainSourceRegion;
};

const mountainFiles = import.meta.glob("../mountains/*.json", { eager: true });

export const mountainsByRegion = Object.fromEntries(
    MOUNTAIN_REGION_DEFINITIONS.map((region) => {
        const module = mountainFiles[`../mountains/${region.id}.json`] as
            | { default?: EditableMountain[] }
            | EditableMountain[]
            | undefined;
        const mountains = Array.isArray(module) ? module : module?.default;
        return [region.id, mountains ?? []];
    }),
) as Record<MountainSourceRegion, EditableMountain[]>;

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
