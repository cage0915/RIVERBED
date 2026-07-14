import type { APIRoute } from "astro";

import {
    parseWikidataMountainEntity,
    type WikidataEntity,
} from "../../lib/wikidata-mountain";

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

const fetchWikidata = async (url: URL) => {
    const response = await fetch(url, {
        headers: {
            "Api-User-Agent": "RIVERBED-MountainDevTool/1.0 (https://riverbed.cage0915.com)",
        },
        signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Wikidata returned ${response.status}`);
    return response.json();
};

export const GET: APIRoute = async ({ url }) => {
    if (!import.meta.env.DEV) return json({ error: "Not available in production" }, 403);

    const query = url.searchParams.get("q")?.trim() ?? "";
    if (query.length < 1 || query.length > 120) {
        return json({ error: "Enter a valid mountain name" }, 400);
    }

    try {
        const searchResponses = await Promise.all(
            ["zh", "ja", "en"].map(async (language) => {
                const searchUrl = new URL("https://www.wikidata.org/w/api.php");
                searchUrl.search = new URLSearchParams({
                    action: "wbsearchentities",
                    search: query,
                    language,
                    uselang: "zh-hant",
                    type: "item",
                    limit: "8",
                    format: "json",
                }).toString();
                return fetchWikidata(searchUrl) as Promise<{
                    search?: Array<{ id?: string }>;
                }>;
            }),
        );

        const ids = Array.from(
            new Set(
                searchResponses.flatMap((response) =>
                    (response.search ?? []).map((item) => item.id).filter(Boolean),
                ),
            ),
        ).slice(0, 16) as string[];
        if (ids.length === 0) return json({ candidates: [] });

        const entityUrl = new URL("https://www.wikidata.org/w/api.php");
        entityUrl.search = new URLSearchParams({
            action: "wbgetentities",
            ids: ids.join("|"),
            props: "labels|descriptions|claims",
            languages: "zh-hant|zh|ja|en",
            format: "json",
        }).toString();
        const entityResponse = await fetchWikidata(entityUrl) as {
            entities?: Record<string, WikidataEntity>;
        };
        const candidates = ids
            .map((id) => entityResponse.entities?.[id])
            .filter((entity): entity is WikidataEntity => Boolean(entity))
            .map(parseWikidataMountainEntity)
            .sort((left, right) => {
                const leftCompleteness = Number(left.latitude !== null) + Number(left.elevation !== null);
                const rightCompleteness = Number(right.latitude !== null) + Number(right.elevation !== null);
                return rightCompleteness - leftCompleteness;
            });

        return json({ candidates });
    } catch (error) {
        return json(
            { error: error instanceof Error ? error.message : "Wikidata lookup failed" },
            502,
        );
    }
};
