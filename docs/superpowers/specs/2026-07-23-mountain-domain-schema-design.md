# Mountain Domain Schema Design

## Status and Scope

This design establishes one production-neutral Mountain type and validates all
stored Mountain JSON at its production read boundary. It addresses type
ownership and stored-data integrity only. Route eligibility, index visibility,
profile completeness, editor UI behavior, and View Transition lifecycle remain
separate work.

## Problem

The canonical Mountain shape currently has no neutral owner:

- `src/lib/mountains.ts` imports `EditableMountain` from the editor module and
  asserts globbed JSON to that type without runtime validation;
- `MountainProfile.astro` declares another `Mountain` and `MountainLocation`;
- the tag detail route casts production data to the component-owned type;
- filesystem helpers and development APIs use the editor-owned type for stored
  production records.

This reverses the intended dependency and lets malformed JSON survive until a
consumer encounters the bad value.

## Decision

Create `src/lib/mountain-schema.ts` as the only owner of the stored Mountain
contract. It exports:

- `Mountain`;
- `MountainLocation`;
- `parseMountain(input, contextIds)`;
- `parseMountainArray(input, contextIds)`.

The schema module may depend on the production-neutral map bounds helpers in
`mountain-map.ts`. It must not depend on editor, component, route, Astro, or
filesystem modules.

`EditableMountain` is retired. Editor code may accept loose form values at its
input boundary, but `sanitizeMountainEntry` returns `Mountain`. Loaders,
filesystem helpers, development APIs, routes, and components all import the
canonical type from `mountain-schema.ts`.

## Stored Schema

A stored Mountain is an object with these fields:

```ts
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
```

Validation is strict:

- root and `location` objects reject unknown fields;
- `name` is a non-empty trimmed string of at most 120 characters;
- `alternateName`, when present, is a non-empty trimmed string of at most 200
  characters;
- `description` is a string of at most 5000 characters;
- `elevation` is `null` or a finite integer from -500 through 9000;
- `coverKey`, when present, matches the existing
  `<folder>/<album>/<photo>` key rules;
- `location`, when present, contains finite numeric latitude and longitude in
  their geographic ranges and a known `mapContext`;
- `initialBounds`, when present, contains only `west`, `south`, `east`, and
  `north`, and passes `isValidMapBounds`;
- `panorama`, when present, is a boolean;
- missing optional fields remain absent rather than receiving defaults.

Production parsing is intentionally not coercive. Numeric strings, whitespace
normalization, empty optional form values, and rounding belong to the editor
input sanitizer, not to stored-data parsing.

## Production Data Flow

`src/lib/mountains.ts` continues to discover region JSON with
`import.meta.glob`, but each module is passed through `parseMountainArray`
before it enters `mountainsByRegion` or `allMountains`.

```text
src/mountains/<region>.json
        ↓ import.meta.glob
parseMountainArray(raw, knownMapContextIds)
        ↓ Mountain[]
mountainsByRegion → allMountains → routes/components
```

The known context IDs come from the existing map-context definition boundary,
not from editor state. A parse failure aborts dev/build and identifies the
source JSON path and array index. Consumers therefore receive validated
`Mountain` values without assertions.

Filesystem-backed development helpers also parse stored arrays through the
same schema before returning them. This prevents the browser-facing loader and
development APIs from interpreting persisted Mountain files differently.

## Editor Flow

`sanitizeMountainEntry` remains responsible for turning form/API input into a
stored Mountain:

- trims strings;
- converts permitted numeric strings;
- rounds elevation and coordinates to storage precision;
- treats empty optional form values as absent;
- drops transient lookup metadata such as `dataSource`;
- validates the final object through the canonical parser before returning it.

This preserves current editor behavior while making the output contract belong
to the domain module. Stored JSON never uses the editor's coercive path when it
is read back.

## Error Behavior

Schema errors name the invalid field and reason, for example an unknown field,
out-of-range coordinate, unknown map context, or invalid cover key.

The production loader wraps schema errors with the JSON module path and entry
index. It does not skip invalid records or substitute defaults. A malformed
stored record is a repository error and must stop dev/build.

Development API behavior remains unchanged at the HTTP boundary: existing
routes may translate thrown validation errors into their current error
responses. This work does not redesign route status codes or response shapes.

## Consumer Migration

The migration updates all Mountain consumers in one coordinated change:

- `mountains.ts` imports and returns canonical `Mountain` values;
- `mountain-files.ts` reads and writes canonical values and validates reads;
- `mountain-editor.ts` returns canonical values but retains input coercion;
- `MountainProfile.astro` imports `Mountain` and stops exporting domain types;
- the tag detail route removes its component-type cast;
- `MountainDevTool.astro` and development APIs replace `EditableMountain` with
  `Mountain` where the value represents a sanitized or stored record.

Temporary unsanitized form drafts may use local UI-only types if required, but
those types must not be exported as the production Mountain contract.

## Testing

Implementation follows red-green-refactor cycles and adds focused tests for:

- valid canonical records and optional fields;
- strict rejection of root and nested unknown fields;
- rejection of coercible-but-invalid stored values such as numeric strings;
- name, description, elevation, cover-key, coordinate, map-context,
  initial-bounds, and panorama constraints;
- array validation with a useful failing entry index;
- production source errors containing the JSON path and entry index;
- filesystem readers using the canonical parser;
- editor coercion still producing the canonical stored shape;
- repository ownership guards that prevent production loaders from importing
  `mountain-editor.ts` and prevent components from declaring canonical Mountain
  types.

Completion requires the focused Mountain tests, full `npm test`,
`npm exec astro check`, and `npm run build` to pass. The build must validate all
281 currently stored Mountain records.

## Non-Goals

This change does not:

- decide which Mountains receive index cards or detail routes;
- require every Mountain to have elevation, coordinates, cover, or panorama;
- change persisted Mountain JSON content unless validation exposes an existing
  invalid record;
- introduce Zod or another schema dependency;
- reorganize the Mountain editor UI;
- change map rendering or contour generation;
- address client lifecycle behavior.
