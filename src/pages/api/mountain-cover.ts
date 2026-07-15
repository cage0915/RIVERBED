import type { APIRoute } from "astro";

import type { EditableMountain } from "../../lib/mountain-editor";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
        },
    });

export const POST: APIRoute = async ({ request }) => {
    if (!import.meta.env.DEV) {
        return json({ error: "Not available in production" }, 403);
    }

    let body: { mountainName?: string; coverKey?: string };
    try {
        body = await request.json();
    } catch {
        return json({ error: "Invalid JSON body" }, 400);
    }

    const mountainName = body.mountainName?.trim();
    const coverKey = body.coverKey?.trim();
    const match = coverKey?.match(/^yama\/([^/]+)\/([^/]+)$/);
    if (!mountainName || !coverKey || !match) {
        return json({ error: "Invalid mountain or cover photo" }, 400);
    }

    const [, albumId, photoKey] = match;
    const path = await import("node:path");
    const fs = await import("node:fs/promises");
    const mountainsFile = path.resolve(process.cwd(), "src/mountains.json");
    const tagsFile = path.resolve(
        process.cwd(),
        "src/album-tags/yama",
        `${albumId}.json`,
    );

    try {
        const [mountainsText, tagsText] = await Promise.all([
            fs.readFile(mountainsFile, "utf8"),
            fs.readFile(tagsFile, "utf8"),
        ]);
        const mountains = JSON.parse(mountainsText) as EditableMountain[];
        const tags = JSON.parse(tagsText) as Record<
            string,
            { name?: string }[]
        >;
        const mountain = mountains.find((entry) => entry.name === mountainName);

        if (!mountain) return json({ error: "Mountain not found" }, 404);
        if (!tags[photoKey]?.some((tag) => tag.name === mountainName)) {
            return json({ error: "Photo does not contain this mountain tag" }, 400);
        }

        mountain.coverKey = coverKey;
        const temporaryFile = `${mountainsFile}.${process.pid}.tmp`;
        await fs.writeFile(
            temporaryFile,
            `${JSON.stringify(mountains, null, 2)}\n`,
            "utf8",
        );
        await fs.rename(temporaryFile, mountainsFile);
        return json({ success: true, coverKey });
    } catch (error) {
        return json(
            {
                error:
                    error instanceof Error
                        ? error.message
                        : "Unable to save mountain cover",
            },
            400,
        );
    }
};
