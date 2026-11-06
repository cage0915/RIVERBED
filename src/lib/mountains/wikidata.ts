type WikidataText = { language: string; value: string };

type WikidataClaim = {
    mainsnak?: {
        datavalue?: {
            value?: unknown;
        };
    };
};

export type WikidataEntity = {
    id: string;
    labels?: Record<string, WikidataText>;
    descriptions?: Record<string, WikidataText>;
    claims?: Record<string, WikidataClaim[]>;
};

export type MountainLookupCandidate = {
    id: string;
    name: string;
    description: string;
    latitude: number | null;
    longitude: number | null;
    elevation: number | null;
    sourceUrl: string;
};

const preferredText = (
    values: Record<string, WikidataText> | undefined,
    fallback: string,
) => {
    for (const language of ["zh-hant", "zh", "ja", "en"]) {
        const value = values?.[language]?.value?.trim();
        if (value) return value;
    }
    return fallback;
};

const firstClaimValue = (entity: WikidataEntity, property: string): unknown =>
    entity.claims?.[property]?.[0]?.mainsnak?.datavalue?.value;

export function parseWikidataMountainEntity(
    entity: WikidataEntity,
): MountainLookupCandidate {
    const coordinate = firstClaimValue(entity, "P625") as
        | { latitude?: unknown; longitude?: unknown }
        | undefined;
    const quantity = firstClaimValue(entity, "P2044") as
        | { amount?: unknown; unit?: unknown }
        | undefined;
    const latitude = Number(coordinate?.latitude);
    const longitude = Number(coordinate?.longitude);
    const elevation = Number(quantity?.amount);
    const supportedElevationUnit =
        quantity?.unit === undefined ||
        quantity.unit === "1" ||
        String(quantity.unit).endsWith("/Q11573");

    return {
        id: entity.id,
        name: preferredText(entity.labels, entity.id),
        description: preferredText(entity.descriptions, ""),
        latitude: Number.isFinite(latitude) ? latitude : null,
        longitude: Number.isFinite(longitude) ? longitude : null,
        elevation:
            supportedElevationUnit && Number.isFinite(elevation)
                ? elevation
                : null,
        sourceUrl: `https://www.wikidata.org/wiki/${entity.id}`,
    };
}
