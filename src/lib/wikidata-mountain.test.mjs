import assert from "node:assert/strict";
import test from "node:test";

import { parseWikidataMountainEntity } from "./wikidata-mountain.ts";

test("Wikidata mountain entities expose preferred labels, coordinates and metres", () => {
    assert.deepEqual(
        parseWikidataMountainEntity({
            id: "Q123",
            labels: {
                ja: { language: "ja", value: "白馬岳" },
                en: { language: "en", value: "Mount Shirouma" },
            },
            descriptions: {
                en: { language: "en", value: "mountain in Japan" },
            },
            claims: {
                P625: [{ mainsnak: { datavalue: { value: { latitude: 36.7586, longitude: 137.7586 } } } }],
                P2044: [{ mainsnak: { datavalue: { value: { amount: "+2932", unit: "http://www.wikidata.org/entity/Q11573" } } } }],
            },
        }),
        {
            id: "Q123",
            name: "白馬岳",
            description: "mountain in Japan",
            latitude: 36.7586,
            longitude: 137.7586,
            elevation: 2932,
            sourceUrl: "https://www.wikidata.org/wiki/Q123",
        },
    );
});

test("Wikidata mountain entities tolerate missing claims", () => {
    const candidate = parseWikidataMountainEntity({ id: "Q999" });
    assert.equal(candidate.name, "Q999");
    assert.equal(candidate.latitude, null);
    assert.equal(candidate.longitude, null);
    assert.equal(candidate.elevation, null);
});
