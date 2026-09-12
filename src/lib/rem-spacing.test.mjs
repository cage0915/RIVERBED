import assert from "node:assert/strict";
import test from "node:test";

import {
    remValueForInput,
    remValueFromInput,
} from "./rem-spacing.ts";

test("spacing editors display rem spacing as unitless numbers", () => {
    assert.equal(remValueForInput("2rem"), "2");
    assert.equal(remValueForInput(" 0.50REM "), "0.5");
    assert.equal(remValueForInput("-.25rem"), "-0.25");
    assert.equal(remValueForInput(""), "");
});

test("spacing editors persist numeric spacing as rem values", () => {
    assert.equal(remValueFromInput("1.5"), "1.5rem");
    assert.equal(remValueFromInput("0"), "0rem");
    assert.equal(remValueFromInput("-0"), "0rem");
    assert.equal(remValueFromInput("calc(1rem + 2px)"), "");
});
