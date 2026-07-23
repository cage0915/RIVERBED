import type { Mountain } from "./mountain-schema.ts";
import { parseMountainRegionSource } from "./mountain-source.ts";
import {
    commitTextFiles,
    type TextFileProposal,
} from "./source-transaction.ts";
import {
    MOUNTAIN_REGIONS,
    type MountainRegion,
    type MountainSourceRegion,
} from "./mountain-regions.ts";
import type { MountainWithRegion } from "./mountains.ts";

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

const readJsonSource = async (file: string): Promise<unknown> => {
    const fs = await import("node:fs/promises");
    try {
        return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Invalid Mountain source ${file}: ${message}`, { cause });
    }
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
    const file = await regionFile(region);
    const input = await readJsonSource(file);
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

export const createMountainRegionProposal = async (
    region: MountainSourceRegion,
    mountains: Mountain[],
    contextIds?: ReadonlySet<string>,
): Promise<TextFileProposal> => {
    const file = await regionFile(region);
    const validated = parseMountainRegionSource(
        mountains,
        file,
        contextIds ?? (await readConfiguredContextIds()),
    );
    const sorted = validated.sort((left, right) =>
        left.name.localeCompare(right.name, "zh-Hant"),
    );
    return {
        target: file,
        contents: `${JSON.stringify(sorted, null, 2)}\n`,
    };
};

export const writeMountainRegion = async (
    region: MountainSourceRegion,
    mountains: Mountain[],
    contextIds?: ReadonlySet<string>,
) => {
    await commitTextFiles([
        await createMountainRegionProposal(region, mountains, contextIds),
    ]);
};

export const findMountainRegion = async (name: string) =>
    (await readAllMountainRegions()).find((mountain) => mountain.name === name);

export const createAllMountainRegionProposals = async (
    mountains: MountainWithRegion[],
    contextIds?: ReadonlySet<string>,
): Promise<TextFileProposal[]> => {
    const regions: MountainSourceRegion[] = [...MOUNTAIN_REGIONS];
    const resolvedContextIds = contextIds ?? (await readConfiguredContextIds());
    return Promise.all(
        regions.map((region) =>
            createMountainRegionProposal(
                region,
                mountains
                    .filter((mountain) => mountain.region === region)
                    .map(({ region: _region, ...mountain }) => mountain),
                resolvedContextIds,
            ),
        ),
    );
};

export const writeAllMountainRegions = async (
    mountains: MountainWithRegion[],
    contextIds?: ReadonlySet<string>,
) => {
    await commitTextFiles(
        await createAllMountainRegionProposals(mountains, contextIds),
    );
};
