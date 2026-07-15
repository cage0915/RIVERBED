import type { EditableMountain } from "./mountain-editor";
import {
    MOUNTAIN_REGIONS,
    type MountainRegion,
    type MountainSourceRegion,
    type MountainWithRegion,
} from "./mountains";

export const isMountainRegion = (value: unknown): value is MountainRegion =>
    typeof value === "string" &&
    MOUNTAIN_REGIONS.includes(value as MountainRegion);

export const isMountainSourceRegion = (
    value: unknown,
): value is MountainSourceRegion =>
    isMountainRegion(value);

const regionFile = async (region: MountainSourceRegion) => {
    const path = await import("node:path");
    return path.resolve(process.cwd(), "src/mountains", `${region}.json`);
};

export const readMountainRegion = async (region: MountainSourceRegion) => {
    const fs = await import("node:fs/promises");
    return JSON.parse(await fs.readFile(await regionFile(region), "utf8")) as
        EditableMountain[];
};

export const readAllMountainRegions = async (): Promise<MountainWithRegion[]> => {
    const regions: MountainSourceRegion[] = [...MOUNTAIN_REGIONS];
    const groups = await Promise.all(
        regions.map(async (region) => ({
            region,
            mountains: await readMountainRegion(region),
        })),
    );
    return groups.flatMap(({ region, mountains }) =>
        mountains.map((mountain) => ({ ...mountain, region })),
    );
};

export const writeMountainRegion = async (
    region: MountainSourceRegion,
    mountains: EditableMountain[],
) => {
    const fs = await import("node:fs/promises");
    const file = await regionFile(region);
    const temporaryFile = `${file}.${process.pid}.tmp`;
    const sorted = [...mountains].sort((left, right) =>
        left.name.localeCompare(right.name, "zh-Hant"),
    );
    await fs.writeFile(
        temporaryFile,
        `${JSON.stringify(sorted, null, 2)}\n`,
        "utf8",
    );
    await fs.rename(temporaryFile, file);
};

export const findMountainRegion = async (name: string) =>
    (await readAllMountainRegions()).find((mountain) => mountain.name === name);

export const writeAllMountainRegions = async (
    mountains: MountainWithRegion[],
) => {
    const regions: MountainSourceRegion[] = [...MOUNTAIN_REGIONS];
    await Promise.all(
        regions.map((region) =>
            writeMountainRegion(
                region,
                mountains
                    .filter((mountain) => mountain.region === region)
                    .map(({ region: _region, ...mountain }) => mountain),
            ),
        ),
    );
};
