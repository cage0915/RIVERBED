import { getMountainContourAssetName } from "./mountain-contours";
import type { MountainSourceRegion } from "./mountains";

const DEFAULT_TAIWAN_DEM_PATH =
    "/private/tmp/riverbed-taiwan-dem/不分幅_全台及澎湖DEM/dem_20m.tif";

export const mountainContourFileExists = async (
    region: MountainSourceRegion,
    name: string,
) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    try {
        await fs.access(
            path.resolve(
                process.cwd(),
                "public/contours",
                region,
                `${getMountainContourAssetName(name)}.svg`,
            ),
        );
        return true;
    } catch {
        return false;
    }
};

const runMountainContourGenerator = async (
    region: MountainSourceRegion,
    name: string,
    options: {
        outputRoot?: string;
        location?: { latitude: number; longitude: number };
    } = {},
) => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { execFile } = await import("node:child_process");
    const script = path.resolve(
        process.cwd(),
        "scripts/generate-mountain-contours.mjs",
    );
    const args = [script, "--region", region, "--mountain", name];
    if (options.outputRoot) args.push("--output", options.outputRoot);
    if (options.location) {
        args.push(
            "--latitude",
            String(options.location.latitude),
            "--longitude",
            String(options.location.longitude),
        );
    }

    if (region === "taiwan") {
        const candidates = [
            import.meta.env.TAIWAN_DEM_PATH,
            process.env.TAIWAN_DEM_PATH,
            DEFAULT_TAIWAN_DEM_PATH,
        ].filter((value): value is string => Boolean(value));
        let demPath: string | undefined;
        for (const candidate of candidates) {
            try {
                await fs.access(candidate);
                demPath = candidate;
                break;
            } catch {
                // Try the next configured DEM path.
            }
        }
        if (!demPath) {
            throw new Error(
                "Taiwan contour generation requires TAIWAN_DEM_PATH to point to dem_20m.tif",
            );
        }
        args.push("--taiwan-dem", demPath);
    }

    await new Promise<void>((resolve, reject) => {
        execFile(
            process.execPath,
            args,
            {
                cwd: process.cwd(),
                timeout: 120_000,
                maxBuffer: 2 * 1024 * 1024,
            },
            (error, _stdout, stderr) => {
                if (!error) return resolve();
                reject(
                    new Error(
                        stderr.trim() ||
                            `Unable to generate contour for ${name}: ${error.message}`,
                    ),
                );
            },
        );
    });
};

export const regenerateMountainContour = async (
    region: MountainSourceRegion,
    name: string,
) => runMountainContourGenerator(region, name);

export const generateMountainContourPreview = async (
    region: MountainSourceRegion,
    name: string,
    location: { latitude: number; longitude: number },
) => {
    const fs = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const temporaryRoot = await fs.mkdtemp(
        path.join(os.tmpdir(), "riverbed-contour-preview-"),
    );
    try {
        await runMountainContourGenerator(region, name, {
            outputRoot: temporaryRoot,
            location,
        });
        return await fs.readFile(
            path.join(
                temporaryRoot,
                region,
                `${getMountainContourAssetName(name)}.svg`,
            ),
            "utf8",
        );
    } finally {
        await fs.rm(temporaryRoot, { recursive: true, force: true });
    }
};
