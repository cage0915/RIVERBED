import assert from "node:assert/strict";
import test from "node:test";

import {
  getMountainContourAssetName,
  getMountainContourAssetUrl,
} from "./mountain-contours.ts";

test("contour asset names are stable and filesystem safe", () => {
  assert.equal(getMountainContourAssetName("玉山"), "玉山");
  assert.equal(getMountainContourAssetName("白馬岳"), "白馬岳");
  assert.equal(getMountainContourAssetName("A/B\\C"), "A／B＼C");
  assert.equal(
    getMountainContourAssetUrl("japan", "白馬岳"),
    "/contours/japan/%E7%99%BD%E9%A6%AC%E5%B2%B3.svg",
  );
});
