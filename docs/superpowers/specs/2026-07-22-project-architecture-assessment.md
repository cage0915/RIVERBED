# RIVERBED Architecture Assessment

## Status and Scope

This document records the current architecture assessment as of 2026-07-23,
after the manifest-backed Album migration, Mountain domain-boundary work, and
View Transition lifecycle refactor were completed.
It is an issue inventory and prioritization document, not an implementation
plan.

The review covers the production static site, content model, build pipeline,
and the boundaries between production and development-only facilities. It does
not review the internal design of `src/dev-api`, `DevTool.astro`,
`MountainDevTool.astro`, R2 administration clients, or their route integration,
except where production code imports or ships development behavior.

## Executive Assessment

RIVERBED's foundation is conventional for a small Astro static content site:
file-based routes, Astro Content Collections, MDX-authored albums, colocated
Astro components, static generation, and R2-hosted images. The project does not
suffer from unnecessary service layers, dependency injection, or framework
abstraction.

The main concern is not that the architecture is unorthodox. The previous
largest data-boundary problems have been addressed: Album metadata, ordering,
photo inventory, captions, and tags now have one validated manifest schema and
one normalized production catalog, while Mountain data has one canonical
schema and validated read boundary. Browser behavior covered by the production
navigation flows now follows one mount/cleanup contract and is owned by focused
components. The remaining risk is concentrated in mountain route policy and a
development-only Mountain cover editor that is not fully isolated from
production client code.

Current characterization:

- framework and deployment architecture: conventional and appropriate;
- production module boundaries: improved for Albums, mountains, and covered
  browser behavior;
- Album content/data discoverability: substantially improved and documented;
- immediate stability: healthy based on current checks;
- future maintenance risk: moderate, concentrated in mountain route policy and
  production/development isolation.

This does not justify a rewrite. It calls for several targeted boundary
improvements.

## Verification Snapshot

The following checks were rerun after the client lifecycle refactor:

- `npm test`: 34 Node test files passed, 0 failed;
- `npm exec astro check`: 0 errors and 3 existing unrelated hints;
- `npm run build`: completed successfully and generated 356 static pages;
- `npm run test:e2e`: 7 production-preview Playwright tests passed, 0 failed.

The checks show that the current project builds, its Node contracts pass, and
the covered browser behavior survives repeated production View Transition
navigation. They do not prove that every route or development facility is easy
to evolve; the open findings below remain outside that browser-test scope.

## Current Production Shape

```text
Astro pages
  ├─ home and folder catalog pages
  ├─ album MDX pages
  ├─ mountain/tag index and detail pages
  └─ RSS
        ↓
focused Astro components composed by the Layout shell
        ↓
src/lib helpers + normalized Album catalog + JSON data + Content Collections
        ↓
R2 images + generated public map/contour assets
```

The dependency graph is shallow, which is a strength. Production Album
consumers now use `src/lib/albums/catalog.ts`; manifest discovery, schema
validation, inventory checks, ordering, asset-key resolution, and tag queries
are behind that boundary. Mountain records are parsed through
`src/lib/mountain-schema.ts` before loaders expose them. Covered client behavior
is mounted through `src/lib/client-page-lifecycle.ts` and scoped by explicit DOM
contracts. Mountain route policy and the Mountain cover editor's environment
boundary are still owned locally by route code.

## Prioritized Findings

### P2: Mountain route-generation policy is surprising

The mountain index includes only mountains with an elevation and finite
coordinates. The tag detail route generates paths from all stored mountain
names plus all photo tag names.

In the current snapshot:

- 281 mountain records existed;
- 104 satisfied the mountain-index visibility criteria;
- 177 lacked an elevation or usable location;
- the build still generated detail routes for the broader name set.

This can be intentional: an incomplete mountain record or photo-only tag may
still deserve a detail page. The problem is that route eligibility, index
visibility, and profile completeness are separate implicit policies.

Recommended direction: name and test the policies explicitly, for example
`isMountainIndexVisible`, `isMountainProfileComplete`, and
`getMountainRouteNames`. Document whether unlinked or photo-only pages are
expected.

### P2: Development-only behavior is not fully isolated from production bundles

`SiteDevTools.astro` conditionally imports the general and Mountain development
tools, which is a good boundary. However, the mountain tag detail route
conditionally renders cover-editing controls while shipping the cover chooser
client script unconditionally. The production JavaScript bundle therefore
contains session state and a request to `/api/mountain-cover`, even though
production markup has no button that triggers it.

Consequences:

- the production boundary is less auditable than the markup suggests;
- dead administration code is shipped to visitors;
- future edits could accidentally expose a production write attempt.

Recommended direction: place the controls and their script in one
development-only component and conditionally import the component. Apply the
same rule to future editor behavior: markup, state, and network actions cross
the environment boundary together.

### P3: Root documentation covers Albums but not the full architecture

The new root `README.md` clearly documents the manifest-backed Album flow,
validation command, editing rules, ownership, external-cover exception, and
schema-version policy. This resolves the most important content-authoring gap.

It is not yet a full repository map. A new maintainer must still infer:

- the overall production page/component/data flow;
- how folder metadata participates in navigation;
- which map and contour files are generated and which are canonical;
- why Unicode contour assets receive hexadecimal production aliases;
- which production modules may interact with development facilities.

Recommended direction: extend the root README with a compact architecture map,
generated-asset policy, production/development boundary, and links to the
focused map and contour documentation. Keep the existing Album section as the
authoritative authoring guide.

## Resolved Since the Original Assessment

### Mountain domain types and validation now have neutral ownership

`src/lib/mountain-schema.ts` owns `Mountain`, `MountainLocation`, cover-key
parsing, and the strict runtime parser. Production glob loading and filesystem
reads validate every Mountain record before exposing it; source failures name
the JSON path and failing array index. The production build successfully
validated all 281 current Mountain records.

Editor input remains separately responsible for trimming, numeric coercion,
rounding, and transient lookup metadata, then validates its final stored shape
through the canonical parser. Components, routes, and development helpers now
consume the domain type without editor-owned aliases, component-owned
duplicates, or presentation-layer assertions.

Filesystem context validation uses the currently persisted context set by
default. Context creation/update operations pass their proposed context set to
Mountain writers, preserving the existing ability to create a context and
assign it in one operation. Context deletion returns a conflict while any
Mountain still references it. Configuration and affected Mountain files are
committed as one serialized, rollback-capable source transaction, so a failed
multi-file write cannot leave the repository between two schema-valid states.

### View Transition client behavior has one cleanup contract

Behavior covered by the repeated-navigation flows now mounts through
`installPageLifecycle`. `astro:page-load` first runs the previous cleanup and
then mounts behavior for the current document. `astro:before-swap` runs the same
idempotent cleanup and clears the active mount. Covered production behavior
aborts event listeners and explicitly disconnects observers, cancels animation
frames, clears timers or intervals, and destroys the current PhotoSwipe
instance where those resources apply.

The Album and Mountain tag routes, catalog cards, navigation, keyboard
navigation, photos, photo rows and carousels, Mountain profile and tag grid no
longer retain `astro:after-swap` initializers. Missing component roots are
normal no-ops, so behavior is selected by the current page rather than its
navigation history. `DevTool.astro` and `MountainDevTool.astro` now use the
shared page-load entry point without claiming that their internal behavior was
otherwise refactored.

JavaScript-owned behavior is exposed through explicit contracts including
`data-site-navigation`, `data-catalog-grid`, `data-catalog-card`,
`data-keyboard-navigation-target`, `data-photo-row`,
`data-photo-lightbox-link`, and route-owned roots. Generic presentation classes
remain available for styling but are no longer the cross-route behavior API for
these interactions.

Home and folder catalog routes now render the same
`CatalogCardInteractions.astro` behavior. Its queries are scoped beneath the
current catalog root, and its listeners and cover-rotation intervals are
released during cleanup.

Production-preview Playwright tests exercise repeated home → folder → home
navigation, touch card behavior, rapid mobile-menu close/reopen and repeated
scrolling, Album → tag → Album round trips with a single PhotoSwipe overlay,
one keyboard scroll response after repeated navigation, and editable targets
that must ignore arrow-key navigation. Screenshots and traces are retained for
failed runs.

### Layout is now a focused composition shell

`Layout.astro` retains the HTML document and head, View Transitions, global font
and stylesheet imports, the main slot, and genuinely global styles. It composes
focused units rather than implementing their policies:

- `SiteNavigation.astro` owns folder discovery, navigation markup, mobile-menu
  state, and scroll-aware navbar behavior;
- `SiteFooter.astro` owns folder footer and homepage RSS-link rendering;
- `ContentKeyboardNavigation.astro` owns global arrow-key navigation over
  explicit targets;
- `PhotoLightbox.astro` owns PhotoSwipe initialization, missing dimensions, and
  cleanup;
- `SiteDevTools.astro` owns development-only tool imports and route selection.

This remains an Astro-component architecture rather than introducing a
framework-independent service layer. The separate production-isolation finding
remains open because the Mountain tag route still contains its own cover-editor
script.

### Album data now has one normalized read boundary

The project selected and completed Option 2, the per-Album manifest design:

- each of the 67 Album MDX files has one slug-paired manifest under
  `src/album-manifests`;
- MDX frontmatter is empty and MDX owns only layout and prose;
- manifests own metadata, order, covers, photo inventory, captions, and tags;
- `src/lib/albums/catalog.ts` is the cached production read boundary used by
  home, folder pages, SiteNavigation, Album rendering, tag routes, and RSS;
- `AlbumPhoto.astro` resolves local filenames through an Album rendering
  context instead of deriving identity from the URL or globbing sidecars;
- legacy `src/album-tags`, `_order.json`, and `utils/tags.ts` storage/readers
  have been removed, with repository tests guarding against reintroduction;
- schema, MDX inventory, one-to-one MDX/manifest pairing, duplicate order,
  local cover membership, and external cover references are validated before
  production build;
- editing and lifecycle operations read and mutate manifests through shared
  file helpers with locking and referential-integrity checks.

The catalog still parses MDX photo component references, but only to validate
that authored layout agrees with the manifest inventory and to distinguish
content photos for tag routes. It does not create a competing metadata source.

### Album catalog assembly and ordering policy are centralized

Home, folder, SiteNavigation, tag routes, and RSS now consume normalized catalog
records. Album order and cover-key resolution are no longer reconstructed from
frontmatter, `_order.json`, and path fallbacks. Pages still perform
view-specific projections, such as selecting the latest published Album or
grouping records by folder; those are presentation policies, not duplicate
storage joins.

Home and folder routes still own their view-specific Album-card markup, but
their mobile interaction and cover rotation are shared through
`CatalogCardInteractions.astro`. This avoids a second Album data policy while
giving both projections one client lifecycle owner.

## What Is Already Appropriate

The following should not be replaced merely to make the architecture appear
more formal:

- Astro file-based routes and static output;
- Astro Content Collections for Album MDX discovery and rendering;
- MDX as the authored layout and prose format;
- small pure functions in `src/lib` with Node tests;
- colocated Astro markup, styles, and client behavior when scoped to one
  component;
- R2 as the external image store;
- generated map and contour assets under `public`;
- the prebuild/postbuild contour alias process.

The contour alias pipeline is unusual but justified and documented: human-readable
Unicode source filenames are retained, temporary hexadecimal aliases work
around Cloudflare Pages asset indexing, and cleanup removes duplicate build
artifacts. This is a legitimate deployment adapter rather than accidental
complexity.

## Recommended Sequence

### Phase 1: Clarify domain boundaries

1. Document and test explicit mountain route/index eligibility policies.

These changes reduce semantic duplication without changing the user interface.

### Phase 2: Complete environment isolation

1. Isolate mountain cover editing as a development-only component.
2. Verify production bundles contain no development write endpoints.

### Phase 3: Extend repository documentation

1. Extend the root architecture and contributor documentation beyond Albums.

## Changes Not Recommended

The current issues do not justify:

- converting the static site to an SSR application;
- adding a database solely to unify local content files;
- introducing repository interfaces or dependency injection for every helper;
- moving all Astro scripts into a global state framework;
- rewriting MDX content into React components;
- reorganizing every file without a concrete boundary problem;
- combining production and development capabilities into one generalized admin
  application.

Those changes would add more concepts than they remove.

## Decision Points

The Album decision is complete: Option 2 was selected and implemented. The
[manifest design](./2026-07-22-album-domain-option-2-manifest-design.md) and
[migration plan](../plans/2026-07-22-album-manifest-migration.md) remain useful
historical rationale, not open choices.

The Mountain domain contract and runtime validation boundary are complete. The
View Transition lifecycle convention and Layout extraction are also complete.
The next Mountain decision is to define explicit route, index, and
profile-completeness policies. Keep that policy work and the development-only
cover editor as separate work items so each can be implemented and verified
independently.

This assessment remains the shared backlog and rationale for that work.
