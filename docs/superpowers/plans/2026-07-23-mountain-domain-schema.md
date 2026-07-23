# Mountain Domain Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give stored Mountain data one canonical type and fail dev/build immediately when production Mountain JSON violates its strict runtime schema.

**Architecture:** `mountain-schema.ts` owns the stored model and strict parser. A small `mountain-source.ts` adapter adds source-path context and is shared by Astro glob loading and filesystem loading. Editor sanitation remains coercive but validates its final value through the canonical parser; all consumers import that canonical type.

**Tech Stack:** TypeScript, Astro 4, Node test runner, JSON content files

---

## File Map

- Create `src/lib/mountain-schema.ts` and `src/lib/mountain-schema.test.mjs` for the canonical contract.
- Create `src/lib/mountain-source.ts` and `src/lib/mountain-source.test.mjs` for source-aware errors.
- Modify `src/lib/mountains.ts` and `src/lib/mountain-files.ts` to validate every read.
- Modify `src/lib/mountain-editor.ts` and its tests to return canonical values after form coercion.
- Modify `MountainProfile.astro`, `MountainDevTool.astro`, the tag detail route, and Mountain dev APIs to consume the canonical type.
- Modify `src/lib/page-structure.test.mjs` to guard dependency direction.
- Modify the architecture assessment only after all verification succeeds.

### Task 1: Add the canonical strict Mountain schema

**Files:**

- Create: `src/lib/mountain-schema.ts`
- Create: `src/lib/mountain-schema.test.mjs`

- [ ] **Step 1: Write the failing schema tests**

Create `src/lib/mountain-schema.test.mjs`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseMountain, parseMountainArray, parseMountainCoverKey } from "./mountain-schema.ts";

const contexts = new Set(["tw-mainland"]);
const valid = (overrides = {}) => ({
    name: "大霸尖山",
    alternateName: "Papak Waqa",
    elevation: 3492,
    description: "測試描述",
    coverKey: "yama/2025-trip/photo.jpg",
    location: {
        latitude: 24.458196,
        longitude: 121.258157,
        mapContext: "tw-mainland",
        initialBounds: { west: 120.9, south: 24.15, east: 121.48, north: 24.72 },
    },
    panorama: true,
    ...overrides,
});

test("parses canonical stored Mountains", () => {
    assert.deepEqual(parseMountain(valid(), contexts), valid());
    assert.deepEqual(parseMountain({ name: "山", elevation: null, description: "" }, contexts), {
        name: "山", elevation: null, description: "",
    });
});

test("rejects unknown root and nested fields", () => {
    assert.throws(() => parseMountain(valid({ dataSource: {} }), contexts), /unknown field.*dataSource/i);
    assert.throws(() => parseMountain(valid({ location: {
        latitude: 24, longitude: 121, mapContext: "tw-mainland", typo: true,
    } }), contexts), /location.*unknown field.*typo/i);
    assert.throws(() => parseMountain(valid({ location: {
        latitude: 24, longitude: 121, mapContext: "tw-mainland",
        initialBounds: { west: 120, south: 23, east: 122, north: 25, typo: 1 },
    } }), contexts), /initialBounds.*unknown field.*typo/i);
});

test("stored parsing never coerces form values", () => {
    assert.throws(() => parseMountain(valid({ elevation: "3492" }), contexts), /elevation/i);
    assert.throws(() => parseMountain(valid({ name: " 山 " }), contexts), /name/i);
    assert.throws(() => parseMountain(valid({ panorama: "true" }), contexts), /panorama/i);
});

test("validates constrained fields", () => {
    assert.throws(() => parseMountain(valid({ alternateName: "" }), contexts), /alternateName/i);
    assert.throws(() => parseMountain(valid({ description: "x".repeat(5001) }), contexts), /description/i);
    assert.throws(() => parseMountain(valid({ elevation: 123.5 }), contexts), /elevation/i);
    assert.throws(() => parseMountain(valid({ coverKey: "broken" }), contexts), /coverKey/i);
    assert.throws(() => parseMountain(valid({ location: {
        latitude: 91, longitude: 121, mapContext: "tw-mainland",
    } }), contexts), /latitude/i);
    assert.throws(() => parseMountain(valid({ location: {
        latitude: 24, longitude: 121, mapContext: "missing",
    } }), contexts), /mapContext/i);
});

test("array errors identify the failing entry", () => {
    assert.throws(() => parseMountainArray([
        { name: "山一", elevation: null, description: "" },
        { name: "山二", elevation: "bad", description: "" },
    ], contexts), /Mountain entry 1.*elevation/i);
});

test("parses cover keys without editor ownership", () => {
    assert.deepEqual(parseMountainCoverKey("y/2026-trip/photo.jpg"), {
        coverKey: "y/2026-trip/photo.jpg", folder: "y", albumId: "2026-trip", photoKey: "photo.jpg",
    });
    assert.equal(parseMountainCoverKey("broken"), null);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run `node --test src/lib/mountain-schema.test.mjs`.

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `mountain-schema.ts`; the missing module is the unimplemented contract.

- [ ] **Step 3: Implement the minimal strict parser**

Create `src/lib/mountain-schema.ts` with this public API:

```ts
import { isValidMapBounds, type MapBounds } from "./mountain-map.ts";

export type MountainLocation = {
    latitude: number;
    longitude: number;
    mapContext: string;
    initialBounds?: MapBounds;
};
export type Mountain = {
    name: string;
    alternateName?: string;
    elevation: number | null;
    description: string;
    coverKey?: string;
    location?: MountainLocation;
    panorama?: boolean;
};
export type MountainCoverKey = {
    coverKey: string;
    folder: string;
    albumId: string;
    photoKey: string;
};

export function parseMountainCoverKey(input: unknown): MountainCoverKey | null;
export function parseMountain(input: unknown, contextIds: ReadonlySet<string>): Mountain;
export function parseMountainArray(input: unknown, contextIds: ReadonlySet<string>): Mountain[];
```

Use `requireRecord`, `rejectUnknownFields`, `requireCanonicalString`, and
`requireFiniteNumber` helpers. Enforce exactly these key lists:

```ts
const ROOT_FIELDS = ["name", "alternateName", "elevation", "description", "coverKey", "location", "panorama"];
const LOCATION_FIELDS = ["latitude", "longitude", "mapContext", "initialBounds"];
const BOUNDS_FIELDS = ["west", "south", "east", "north"];
```

Reject strings needing trimming. Require non-empty `name` and present
`alternateName`, allow empty `description`, require integer elevation in
`-500..9000`, latitude in `-90..90`, longitude in `-180..180`, known map
context, boolean panorama, valid cover key, and strict bounds before calling
`isValidMapBounds`. Copy returned objects so input mutation cannot alter parsed
values. `parseMountainArray` must wrap failures with `Mountain entry ${index}`.

- [ ] **Step 4: Run the test and verify GREEN**

Run `node --test src/lib/mountain-schema.test.mjs`.

Expected: 6 tests pass, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/lib/mountain-schema.ts src/lib/mountain-schema.test.mjs
git commit -m "feat: add canonical mountain schema"
```

### Task 2: Validate production and filesystem sources

**Files:**

- Create: `src/lib/mountain-source.ts`
- Create: `src/lib/mountain-source.test.mjs`
- Modify: `src/lib/mountains.ts`
- Modify: `src/lib/mountain-files.ts`

- [ ] **Step 1: Write the failing source adapter test**

```js
import assert from "node:assert/strict";
import test from "node:test";
import { parseMountainRegionSource } from "./mountain-source.ts";

const contexts = new Set(["tw-mainland"]);
test("source errors identify path and array index", () => {
    assert.throws(() => parseMountainRegionSource([
        { name: "山一", elevation: null, description: "" },
        { name: "山二", elevation: "bad", description: "" },
    ], "/src/mountains/taiwan.json", contexts),
    /Invalid Mountain source \/src\/mountains\/taiwan\.json.*Mountain entry 1.*elevation/is);
});
```

- [ ] **Step 2: Run and verify RED**

Run `node --test src/lib/mountain-source.test.mjs`.

Expected: FAIL because `mountain-source.ts` does not exist.

- [ ] **Step 3: Implement the source adapter**

```ts
import { parseMountainArray, type Mountain } from "./mountain-schema.ts";

export function parseMountainRegionSource(
    input: unknown,
    sourcePath: string,
    contextIds: ReadonlySet<string>,
): Mountain[] {
    try {
        return parseMountainArray(input, contextIds);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(`Invalid Mountain source ${sourcePath}: ${message}`, { cause });
    }
}
```

- [ ] **Step 4: Run and verify GREEN**

Run `node --test src/lib/mountain-source.test.mjs`.

Expected: 1 test passes.

- [ ] **Step 5: Add a failing ownership/read-boundary guard**

Append to `src/lib/page-structure.test.mjs`:

```js
test("Mountain data uses one canonical schema and validated read boundaries", () => {
    const mountains = readProjectFile("src/lib/mountains.ts");
    const files = readProjectFile("src/lib/mountain-files.ts");
    const profile = readProjectFile("src/components/MountainProfile.astro");
    const tagPage = readProjectFile("src/pages/yama/tags/[tag].astro");
    assert.match(mountains, /parseMountainRegionSource/);
    assert.match(files, /parseMountainRegionSource/);
    assert.doesNotMatch(mountains, /mountain-editor|EditableMountain/);
    assert.doesNotMatch(files, /mountain-editor|EditableMountain/);
    assert.match(profile, /import type \{ Mountain \} from ["']\.\.\/lib\/mountain-schema/);
    assert.doesNotMatch(profile, /export type Mountain(?:Location)?\b/);
    assert.doesNotMatch(tagPage, /mountainsData as Mountain\[\]/);
});
```

Run the named test. Expected: FAIL on both loaders and presentation ownership.

- [ ] **Step 6: Validate Astro glob loading**

Change `src/lib/mountains.ts` to import `MAP_CONTEXTS`, canonical `Mountain`,
and `parseMountainRegionSource`. Define `MountainWithRegion = Mountain & {
region: MountainSourceRegion }`. For every configured region, require the
matching glob module and parse its `default` value with:

```ts
parseMountainRegionSource(module.default, sourcePath, new Set(Object.keys(MAP_CONTEXTS)))
```

Remove the `EditableMountain` import, all JSON type assertions, and the missing
module `[]` fallback.

- [ ] **Step 7: Validate filesystem reads and writes**

Change `src/lib/mountain-files.ts` to import canonical `Mountain`,
`MAP_CONTEXTS`, and `parseMountainRegionSource`. Implement reads as:

```ts
const input = JSON.parse(await fs.readFile(file, "utf8"));
return parseMountainRegionSource(input, file, new Set(Object.keys(MAP_CONTEXTS)));
```

Accept `Mountain[]` on writes and call the same parser on the array before
sorted atomic serialization. Remove the editor import.

- [ ] **Step 8: Run focused tests and commit**

Run:

```bash
node --test src/lib/mountain-schema.test.mjs src/lib/mountain-source.test.mjs src/lib/mountain-editor.test.mjs
```

Expected: all pass. Then commit:

```bash
git add src/lib/mountain-source.ts src/lib/mountain-source.test.mjs src/lib/mountains.ts src/lib/mountain-files.ts
git commit -m "refactor: validate mountain data sources"
```

### Task 3: Separate editor input from the stored domain contract

**Files:**

- Modify: `src/lib/mountain-editor.ts`
- Modify: `src/lib/mountain-editor.test.mjs`
- Modify: `src/dev-api/mountain-contexts.ts`
- Modify: `src/dev-api/mountain-regions.ts`
- Modify: `src/dev-api/mountain-cover.ts`
- Modify: `src/components/MountainDevTool.astro`

- [ ] **Step 1: Add a failing editor ownership test**

Add to `src/lib/mountain-editor.test.mjs`:

```js
import fs from "node:fs";
import { parseMountain } from "./mountain-schema.ts";

test("editor output satisfies the canonical stored schema", () => {
    const result = sanitizeMountainEntry({
        name: " 山 ", elevation: "1234.6", description: " 描述 ",
        location: { latitude: "24.1234567", longitude: "121.7654326", mapContext: "tw-dabajian" },
        panorama: false,
        dataSource: { wikidataId: "Q1" },
    }, contexts);
    assert.deepEqual(parseMountain(result, contexts), result);
});

test("editor delegates the stored contract to mountain-schema", () => {
    const source = fs.readFileSync(new URL("./mountain-editor.ts", import.meta.url), "utf8");
    assert.match(source, /parseMountain/);
    assert.doesNotMatch(source, /export type EditableMountain/);
});
```

- [ ] **Step 2: Run and verify RED**

Run:

```bash
node --test --test-name-pattern="canonical stored schema|delegates the stored contract" src/lib/mountain-editor.test.mjs
```

Expected: the output-shape test passes, but ownership FAILS because the editor
still declares `EditableMountain` and does not call the canonical parser.

- [ ] **Step 3: Refactor editor sanitation**

In `src/lib/mountain-editor.ts` import:

```ts
import { parseMountain, parseMountainCoverKey, type Mountain } from "./mountain-schema.ts";
```

Delete `EditableMountain`, `MountainCoverKey`, and the local cover-key parser.
Keep current coercion, trimming, rounding, optional omission, and transient
metadata removal. Declare `result: Mountain` and finish with:

```ts
return parseMountain(result, contextIds);
```

The sanitizer signature becomes:

```ts
export function sanitizeMountainEntry(
    input: unknown,
    contextIds: ReadonlySet<string>,
): Mountain;
```

- [ ] **Step 4: Migrate dev API imports**

Make the following exact ownership changes:

```ts
// src/dev-api/mountain-contexts.ts
import { sanitizeMountainEntry } from "../lib/mountain-editor";
import type { Mountain } from "../lib/mountain-schema";
// EditableMountain[] -> Mountain[]
// EditableMountain | undefined -> Mountain | undefined

// src/dev-api/mountain-cover.ts
import { parseMountainCoverKey } from "../lib/mountain-schema";
```

In `src/dev-api/mountain-regions.ts`, remove `EditableMountain`. When reading a
region being removed, call `parseMountainRegionSource` with the file path and
`new Set(Object.keys(MAP_CONTEXTS))` before checking `.length`.

In `src/components/MountainDevTool.astro`, replace its editor-owned type import
and all `EditableMountain` annotations without changing behavior:

```ts
import type { Mountain } from "../lib/mountain-schema";
import type { MountainWithRegion } from "../lib/mountains";
```

- [ ] **Step 5: Run focused tests and Astro check**

Run:

```bash
node --test src/lib/mountain-schema.test.mjs src/lib/mountain-source.test.mjs src/lib/mountain-editor.test.mjs
npm exec astro check
```

Expected: all focused tests pass and Astro reports 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/mountain-editor.ts src/lib/mountain-editor.test.mjs src/dev-api/mountain-contexts.ts src/dev-api/mountain-regions.ts src/dev-api/mountain-cover.ts src/components/MountainDevTool.astro
git commit -m "refactor: separate mountain editor input from domain schema"
```

### Task 4: Migrate presentation consumers and enforce ownership

**Files:**

- Modify: `src/components/MountainProfile.astro`
- Modify: `src/pages/yama/tags/[tag].astro`
- Modify: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Run the ownership guard and verify RED**

Run:

```bash
node --test --test-name-pattern="Mountain data uses one canonical schema" src/lib/page-structure.test.mjs
```

Expected: FAIL because `MountainProfile.astro` still exports its own types and
the tag page still casts to that component-owned type.

- [ ] **Step 2: Migrate MountainProfile and the tag route**

Replace both exported type blocks in `MountainProfile.astro` with:

```ts
import type { Mountain } from "../lib/mountain-schema";
```

Keep `interface Props { mountain: Mountain }`. In the tag route, change to:

```ts
import MountainProfile from "../../../components/MountainProfile.astro";
const mountain = mountainsData.find((entry) => entry.name === decodedTag);
```

Delete the component type import and `mountainsData as Mountain[]` cast.

- [ ] **Step 3: Run the ownership guard and verify GREEN**

Run the named `page-structure` test again. Expected: pass.

- [ ] **Step 4: Confirm the old owner is gone**

Run:

```bash
rg -n "EditableMountain|mountainsData as Mountain\[\]|export type MountainLocation" src -g '!src/lib/mountain-schema.ts'
rg -n "export type Mountain =" src
```

Expected: the first command has no matches; the second has exactly one match in
`src/lib/mountain-schema.ts`.

- [ ] **Step 5: Run Astro check and commit**

Run `npm exec astro check`; expect 0 errors. Then commit:

```bash
git add src/components/MountainProfile.astro src/pages/yama/tags/[tag].astro src/lib/page-structure.test.mjs
git commit -m "refactor: use canonical mountain types"
```

### Task 5: Verify all stored data and close the assessment finding

**Files:**

- Modify: `docs/superpowers/specs/2026-07-22-project-architecture-assessment.md`

- [ ] **Step 1: Run all Mountain and ownership tests**

Run:

```bash
node --test src/lib/mountain-*.test.mjs src/lib/page-structure.test.mjs
```

Expected: 0 failures across schema, source, editor, map, coordinates, panorama,
tag sorting, and ownership tests.

- [ ] **Step 2: Run the full test suite**

Run `npm test` and require 0 failures.

- [ ] **Step 3: Validate all 281 records through production build**

Run `npm run build`. Require a successful static build and successful contour
cleanup. Because `mountains.ts` validates every configured module, this proves
all 281 current stored records pass the runtime schema.

- [ ] **Step 4: Update the architecture assessment**

Move `P1: Mountain domain types have reversed and duplicated ownership` into
`Resolved Since the Original Assessment` and record:

```markdown
### Mountain domain types and validation now have neutral ownership

`src/lib/mountain-schema.ts` owns the canonical stored type and strict runtime
parser. Production glob loading and filesystem reads validate every Mountain
record before exposing it; editor input is normalized separately and then
checked against the same schema. Components and routes consume the domain type
without assertions or component-owned duplicates.
```

Do not mark the separate Mountain route-generation policy as resolved.

- [ ] **Step 5: Verify documentation and worktree state**

Run:

```bash
rg -n "Mountain domain|Resolved Since|Mountain route-generation" docs/superpowers/specs/2026-07-22-project-architecture-assessment.md
git diff --check
git status --short
```

Expected: ownership is resolved, route policy remains prioritized, no whitespace
errors exist, and only intended files are changed.

- [ ] **Step 6: Commit the assessment**

```bash
git add docs/superpowers/specs/2026-07-22-project-architecture-assessment.md
git commit -m "docs: reassess mountain domain ownership"
```
