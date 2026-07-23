import type { Mountain } from "./mountain-schema.ts";
import { parseMountainRegionSource } from "./mountain-source.ts";
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

const readConfiguredContextIds = async (): Promise<ReadonlySet<string>> => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const configFile = path.resolve(process.cwd(), "src/map-contexts.json");
    const input = JSON.parse(await fs.readFile(configFile, "utf8")) as {
        contexts?: unknown;
    };
    if (
        typeof input !== "object" ||
        input === null ||
        typeof input.contexts !== "object" ||
        input.contexts === null ||
        Array.isArray(input.contexts)
    ) {
        throw new Error(`Invalid map context source ${configFile}`);
    }
    return new Set(Object.keys(input.contexts));
};

export const readMountainRegion = async (
    region: MountainSourceRegion,
    contextIds?: ReadonlySet<string>,
): Promise<Mountain[]> => {
    const fs = await import("node:fs/promises");
    const file = await regionFile(region);
    const input = JSON.parse(await fs.readFile(file, "utf8"));
    return parseMountainRegionSource(
        input,
        file,
        contextIds ?? (await readConfiguredContextIds()),
    );
};

export const readAllMountainRegions = async (
    contextIds?: ReadonlySet<string>,
): Promise<MountainWithRegion[]> => {
    const regions: MountainSourceRegion[] = [...MOUNTAIN_REGIONS];
    const resolvedContextIds = contextIds ?? (await readConfiguredContextIds());
    const groups = await Promise.all(
        regions.map(async (region) => ({
            region,
            mountains: await readMountainRegion(region, resolvedContextIds),
        })),
    );
    return groups.flatMap(({ region, mountains }) =>
        mountains.map((mountain) => ({ ...mountain, region })),
    );
};

export const writeMountainRegion = async (
    region: MountainSourceRegion,
    mountains: Mountain[],
    contextIds?: ReadonlySet<string>,
) => {
    const fs = await import("node:fs/promises");
    const file = await regionFile(region);
    const temporaryFile = `${file}.${process.pid}.tmp`;
    const validated = parseMountainRegionSource(
        mountains,
        file,
        contextIds ?? (await readConfiguredContextIds()),
    );
    const sorted = validated.sort((left, right) =>
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
    contextIds?: ReadonlySet<string>,
) => {
    const regions: MountainSourceRegion[] = [...MOUNTAIN_REGIONS];
    const resolvedContextIds = contextIds ?? (await readConfiguredContextIds());
    await Promise.all(
        regions.map((region) =>
            writeMountainRegion(
                region,
                mountains
                    .filter((mountain) => mountain.region === region)
                    .map(({ region: _region, ...mountain }) => mountain),
                resolvedContextIds,
            ),
        ),
    );
};
