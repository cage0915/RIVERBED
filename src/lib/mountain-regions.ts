import regionData from "../mountain-regions.json" with { type: "json" };

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
