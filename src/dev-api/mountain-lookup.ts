import type { APIRoute } from "astro";

import {
    parseWikidataMountainEntity,
    type MountainLookupCandidate,
    type WikidataEntity,
} from "../lib/wikidata-mountain";

const WIKIDATA_USER_AGENT =
    "RIVERBED-MountainDevTool/1.1 (https://riverbed.cage0915.com)";
const CACHE_TTL_MS = 5 * 60 * 1000;
const lookupCache = new Map<
    string,
    { expiresAt: number; candidates: MountainLookupCandidate[] }
>();

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });

const retryDelayMs = (response: Response) => {
    const value = response.headers.get("Retry-After");
    if (!value) return 1_000;

    const seconds = Number(value);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);

    const retryAt = Date.parse(value);
    return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : 1_000;
};

const fetchWikidata = async (url: URL, canRetry = true): Promise<unknown> => {
    const response = await fetch(url, {
        headers: {
            "User-Agent": WIKIDATA_USER_AGENT,
            "Api-User-Agent": WIKIDATA_USER_AGENT,
        },
        signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 429 && canRetry) {
        const delay = retryDelayMs(response);
        if (delay <= 5_000) {
            await new Promise((resolve) => setTimeout(resolve, delay));
            return fetchWikidata(url, false);
        }
    }
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
        const cacheKey = query.toLocaleLowerCase();
        const cached = lookupCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
            return json({ candidates: cached.candidates });
        }
        if (cached) lookupCache.delete(cacheKey);

        const idSet = new Set<string>();
        for (const language of ["zh-hant", "zh", "ja", "en"]) {
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
            const response = await fetchWikidata(searchUrl) as {
                search?: Array<{ id?: string }>;
            };
            for (const item of response.search ?? []) {
                if (item.id) idSet.add(item.id);
            }
            if (idSet.size >= 8) break;
        }

        const ids = Array.from(idSet).slice(0, 16);
        if (ids.length === 0) {
            lookupCache.set(cacheKey, {
                expiresAt: Date.now() + CACHE_TTL_MS,
                candidates: [],
            });
            return json({ candidates: [] });
        }

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

        lookupCache.set(cacheKey, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            candidates,
        });

        return json({ candidates });
    } catch (error) {
        return json(
            { error: error instanceof Error ? error.message : "Wikidata lookup failed" },
            502,
        );
    }
};
// Registered only by the local development server.
