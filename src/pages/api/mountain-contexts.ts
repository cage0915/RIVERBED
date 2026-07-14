import type { APIRoute } from "astro";

import { sanitizeMountainEntry, type EditableMountain } from "../../lib/mountain-editor";
import { isValidMapBounds, type MapBounds } from "../../lib/mountain-map";

type ContextConfig = {
    id: string;
    label: string;
    level: "country" | "admin1" | "region";
    source: string;
    bounds: MapBounds;
    visibleFeatures?: string[];
    protected?: boolean;
};

type MapConfigFile = {
    contexts: Record<string, ContextConfig>;
};

type ContextRequestBody = {
    id?: string;
    label?: string;
    baseContextId?: string;
    originalId?: string;
    bounds?: unknown;
    originalName?: string;
    mountain?: unknown;
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

const readBody = async (request: Request): Promise<ContextRequestBody | null> => {
    try {
        return await request.json() as ContextRequestBody;
    } catch {
        return null;
    }
};

const normalizeContextFields = (body: ContextRequestBody) => {
    const id = body.id?.trim();
    const label = body.label?.trim();
    if (!id || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
        throw new Error("Context ID must use lowercase letters, numbers and hyphens");
    }
    if (!label || label.length > 80) throw new Error("Invalid context label");
    if (!isValidMapBounds(body.bounds)) throw new Error("Invalid context bounds");
    return { id, label, bounds: roundedBounds(body.bounds) };
};

const roundedBounds = (bounds: MapBounds): MapBounds => ({
    west: Number(bounds.west.toFixed(6)),
    south: Number(bounds.south.toFixed(6)),
    east: Number(bounds.east.toFixed(6)),
    north: Number(bounds.north.toFixed(6)),
});

const writeJsonPair = async (
    configFile: string,
    config: MapConfigFile,
    mountainsFile: string,
    mountains: EditableMountain[],
) => {
    const fs = await import("node:fs/promises");
    const temporaryConfigFile = `${configFile}.${process.pid}.tmp`;
    const temporaryMountainsFile = `${mountainsFile}.${process.pid}.tmp`;
    await Promise.all([
        fs.writeFile(temporaryConfigFile, `${JSON.stringify(config, null, 2)}\n`, "utf8"),
        fs.writeFile(temporaryMountainsFile, `${JSON.stringify(mountains, null, 2)}\n`, "utf8"),
    ]);
    await fs.rename(temporaryConfigFile, configFile);
    await fs.rename(temporaryMountainsFile, mountainsFile);
};

const saveMountainDraft = (
    body: ContextRequestBody,
    config: MapConfigFile,
    mountains: EditableMountain[],
) => {
    if (body.mountain === undefined) return undefined;
    const originalName = body.originalName?.trim();
    if (!originalName) throw new Error("Missing original mountain name");
    const mountain = sanitizeMountainEntry(
        body.mountain,
        new Set(Object.keys(config.contexts)),
    );
    if (mountain.name !== originalName) throw new Error("Renaming mountains is not supported yet");
    const mountainIndex = mountains.findIndex((entry) => entry.name === originalName);
    if (mountainIndex < 0) throw new Error("Mountain not found");
    mountains[mountainIndex] = mountain;
    return mountain;
};

const getFiles = async () => {
    const path = await import("node:path");
    return {
        configFile: path.resolve(process.cwd(), "src/map-contexts.json"),
        mountainsFile: path.resolve(process.cwd(), "src/mountains.json"),
    };
};

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);
    const body = await readBody(request);
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    try {
        const fields = normalizeContextFields(body);
        const baseContextId = body.baseContextId?.trim();
        if (!baseContextId) return json({ error: "Missing base context" }, 400);
        const fs = await import("node:fs/promises");
        const { configFile, mountainsFile } = await getFiles();
        const [config, mountains] = await Promise.all([
            fs.readFile(configFile, "utf8").then((value) => JSON.parse(value) as MapConfigFile),
            fs.readFile(mountainsFile, "utf8").then((value) => JSON.parse(value) as EditableMountain[]),
        ]);
        if (config.contexts[fields.id]) {
            return json({ error: `Context ID "${fields.id}" already exists` }, 409);
        }
        const baseContext = config.contexts[baseContextId];
        if (!baseContext) return json({ error: "Base context not found" }, 404);

        const context: ContextConfig = {
            id: fields.id,
            label: fields.label,
            level: "region",
            source: baseContext.source,
            bounds: fields.bounds,
            ...(baseContext.visibleFeatures
                ? { visibleFeatures: [...baseContext.visibleFeatures] }
                : {}),
        };
        config.contexts[fields.id] = context;
        const mountain = saveMountainDraft(body, config, mountains);
        await writeJsonPair(configFile, config, mountainsFile, mountains);
        return json({ success: true, context, ...(mountain ? { mountain } : {}) });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Unable to save context" }, 400);
    }
};

export const PUT: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);
    const body = await readBody(request);
    if (!body) return json({ error: "Invalid JSON body" }, 400);

    try {
        const fields = normalizeContextFields(body);
        const originalId = body.originalId?.trim();
        if (!originalId) return json({ error: "Missing original context ID" }, 400);
        const fs = await import("node:fs/promises");
        const { configFile, mountainsFile } = await getFiles();
        const [config, mountains] = await Promise.all([
            fs.readFile(configFile, "utf8").then((value) => JSON.parse(value) as MapConfigFile),
            fs.readFile(mountainsFile, "utf8").then((value) => JSON.parse(value) as EditableMountain[]),
        ]);
        const context = config.contexts[originalId];
        if (!context) return json({ error: `Context ID "${originalId}" was not found` }, 404);
        if (fields.id !== originalId && config.contexts[fields.id]) {
            return json({ error: `Context ID "${fields.id}" already exists` }, 409);
        }

        const updatedContext = {
            ...context,
            id: fields.id,
            label: fields.label,
            bounds: fields.bounds,
        };
        if (fields.id !== originalId) delete config.contexts[originalId];
        config.contexts[fields.id] = updatedContext;

        let affectedMountains = 0;
        for (const mountain of mountains) {
            if (mountain.location?.mapContext !== originalId) continue;
            mountain.location.mapContext = fields.id;
            delete mountain.location.initialBounds;
            affectedMountains += 1;
        }
        const mountain = saveMountainDraft(body, config, mountains);
        await writeJsonPair(configFile, config, mountainsFile, mountains);
        return json({
            success: true,
            context: updatedContext,
            affectedMountains,
            ...(mountain ? { mountain } : {}),
        });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Unable to update context" }, 400);
    }
};

export const DELETE: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);
    const body = await readBody(request);
    if (!body) return json({ error: "Invalid JSON body" }, 400);
    const id = body.id?.trim();
    if (!id) return json({ error: "Missing context ID" }, 400);

    try {
        const fs = await import("node:fs/promises");
        const { configFile, mountainsFile } = await getFiles();
        const [config, mountains] = await Promise.all([
            fs.readFile(configFile, "utf8").then((value) => JSON.parse(value) as MapConfigFile),
            fs.readFile(mountainsFile, "utf8").then((value) => JSON.parse(value) as EditableMountain[]),
        ]);
        const context = config.contexts[id];
        if (!context) return json({ error: `Context ID "${id}" was not found` }, 404);
        if (context.protected) {
            return json({ error: `Context ID "${id}" is code-owned and cannot be deleted in DevTool` }, 403);
        }
        const affectedMountains = mountains
            .filter((mountain) => mountain.location?.mapContext === id)
            .map((mountain) => mountain.name);
        delete config.contexts[id];

        // Preserve coordinates and the now-missing context ID. Dev and production
        // both suppress the map until another valid context is assigned.
        await writeJsonPair(configFile, config, mountainsFile, mountains);
        return json({
            success: true,
            deletedContextId: id,
            affectedMountains,
            affectedCount: affectedMountains.length,
        });
    } catch (error) {
        return json({ error: error instanceof Error ? error.message : "Unable to delete context" }, 400);
    }
};
