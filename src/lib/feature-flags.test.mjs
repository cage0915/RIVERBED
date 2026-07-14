import assert from "node:assert/strict";
import test from "node:test";

import { resolveFeatureFlag } from "./feature-flags.ts";

test("feature flags accept common enabled and disabled values", () => {
    for (const value of ["1", "true", "TRUE", "yes", "on", true]) {
        assert.equal(resolveFeatureFlag(value, false), true);
    }

    for (const value of ["0", "false", "FALSE", "no", "off", false]) {
        assert.equal(resolveFeatureFlag(value, true), false);
    }
});

test("feature flags use their fallback for missing or invalid values", () => {
    assert.equal(resolveFeatureFlag(undefined, true), true);
    assert.equal(resolveFeatureFlag("invalid", false), false);
});
