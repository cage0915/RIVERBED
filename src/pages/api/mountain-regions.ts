import type { APIRoute } from "astro";

import type { EditableMountain } from "../../lib/mountain-editor";
import {
    sanitizeMountainViewSettings,
    type MountainViewSettings,
} from "../../lib/mountain-view-settings";
import type { MountainRegionDefinition } from "../../lib/mountains";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });

const files = async () => {
    const path = await import("node:path");
    return {
        config: path.resolve(process.cwd(), "src/mountain-regions.json"),
        viewSettings: path.resolve(
            process.cwd(),
            "src/mountain-view-settings.json",
        ),
        directory: path.resolve(process.cwd(), "src/mountains"),
    };
};

const readRegions = async () => {
    const fs = await import("node:fs/promises");
    const { config } = await files();
    return JSON.parse(await fs.readFile(config, "utf8")) as
        MountainRegionDefinition[];
};

const readViewSettings = async () => {
    const fs = await import("node:fs/promises");
    const { viewSettings } = await files();
    return sanitizeMountainViewSettings(
        JSON.parse(await fs.readFile(viewSettings, "utf8")),
    );
};

const sanitizeRegions = (input: unknown): MountainRegionDefinition[] => {
    if (!Array.isArray(input) || input.length === 0) {
        throw new Error("At least one region is required");
    }
    const regions = input.map((candidate) => {
        if (!candidate || typeof candidate !== "object") {
            throw new Error("Invalid region");
        }
        const item = candidate as Record<string, unknown>;
        const id = typeof item.id === "string" ? item.id.trim() : "";
        const label = typeof item.label === "string" ? item.label.trim() : "";
        if (!/^[a-z0-9][a-z0-9-]{1,39}$/.test(id)) {
            throw new Error(`Invalid region ID: ${id || "empty"}`);
        }
        if (!label || label.length > 60) {
            throw new Error(`Invalid label for region: ${id}`);
        }
        return { id, label };
    });
    if (new Set(regions.map((region) => region.id)).size !== regions.length) {
        throw new Error("Region IDs must be unique");
    }
    return regions;
};

export const GET: APIRoute = async () => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);
    const [regions, settings] = await Promise.all([
        readRegions(),
        readViewSettings(),
    ]);
    return json({ regions, settings });
};

export const PUT: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);

    let body: { regions?: unknown; settings?: unknown };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, 400);
    }

    try {
        const nextRegions = sanitizeRegions(body.regions);
        const [currentRegions, currentSettings] = await Promise.all([
            readRegions(),
            readViewSettings(),
        ]);
        const nextSettings: MountainViewSettings =
            body.settings === undefined
                ? currentSettings
                : sanitizeMountainViewSettings(body.settings);
        const currentIds = new Set(currentRegions.map((region) => region.id));
        const nextIds = new Set(nextRegions.map((region) => region.id));
        const removedIds = [...currentIds].filter((id) => !nextIds.has(id));
        const addedIds = [...nextIds].filter((id) => !currentIds.has(id));
        const fs = await import("node:fs/promises");
        const path = await import("node:path");
        const { config, viewSettings, directory } = await files();

        for (const id of removedIds) {
            const file = path.join(directory, `${id}.json`);
            const mountains = JSON.parse(
                await fs.readFile(file, "utf8"),
            ) as EditableMountain[];
            if (mountains.length > 0) {
                return json(
                    { error: `Region "${id}" still contains ${mountains.length} mountains` },
                    409,
                );
            }
        }

        for (const id of addedIds) {
            const file = path.join(directory, `${id}.json`);
            try {
                await fs.writeFile(file, "[]\n", { encoding: "utf8", flag: "wx" });
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
            }
        }

        const temporaryFile = `${config}.${process.pid}.tmp`;
        await fs.writeFile(
            temporaryFile,
            `${JSON.stringify(nextRegions, null, 2)}\n`,
            "utf8",
        );
        const temporarySettingsFile = `${viewSettings}.${process.pid}.tmp`;
        await fs.writeFile(
            temporarySettingsFile,
            `${JSON.stringify(nextSettings, null, 2)}\n`,
            "utf8",
        );
        await fs.rename(temporaryFile, config);
        await fs.rename(temporarySettingsFile, viewSettings);

        for (const id of removedIds) {
            await fs.unlink(path.join(directory, `${id}.json`));
        }

        return json({
            success: true,
            regions: nextRegions,
            settings: nextSettings,
        });
    } catch (error) {
        return json(
            { error: error instanceof Error ? error.message : "Unable to save regions" },
            400,
        );
    }
};
