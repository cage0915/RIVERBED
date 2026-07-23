# RIVERBED Architecture Assessment

## Status and Scope

This document records the current architecture assessment as of 2026-07-23,
after the manifest-backed Album migration was completed.
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
largest data-boundary problem has been addressed: Album metadata, ordering,
photo inventory, captions, and tags now have one validated manifest schema and
one normalized production catalog. Mountain data now also has one canonical
schema and validated read boundary. The remaining risk is concentrated in
mountain route policy and in client scripts that use broad document-level
selectors and persistent View Transition listeners.

Current characterization:

- framework and deployment architecture: conventional and appropriate;
- production module boundaries: improved for Albums and mountains, still
  inconsistent for browser behavior;
- Album content/data discoverability: substantially improved and documented;
- immediate stability: healthy based on current checks;
- future maintenance risk: moderate, concentrated in mountain route policy and
  browser lifecycle behavior.

This does not justify a rewrite. It calls for several targeted boundary
improvements.

## Verification Snapshot

The following checks were rerun after the Album migration:

- `npm test`: 30 tests passed, 0 failed;
- `npm run albums:validate`: 67 of 67 Album manifests valid, 0 diagnostics;
- `npm exec astro check`: 0 errors and 6 hints;
- `npm run build`: completed successfully and generated 356 static pages.

The checks show that the current project builds and its existing pure-function
tests pass. They do not prove that the architecture is easy to evolve, nor do
they cover browser behavior across View Transition navigation.

## Current Production Shape

```text
Astro pages
  ├─ home and folder catalog pages
  ├─ album MDX pages
  ├─ mountain/tag index and detail pages
  └─ RSS
        ↓
Astro components and Layout
        ↓
src/lib helpers + normalized Album catalog + JSON data + Content Collections
        ↓
R2 images + generated public map/contour assets
```

The dependency graph is shallow, which is a strength. Production Album
consumers now use `src/lib/albums/catalog.ts`; manifest discovery, schema
validation, inventory checks, ordering, asset-key resolution, and tag queries
are behind that boundary. Mountain records are now parsed through
`src/lib/mountain-schema.ts` before loaders expose them. Mountain route policy
and some client lifecycle policy are still owned locally by pages/components.

## Prioritized Findings

### P1: View Transition client lifecycle is globally coupled

The site enables Astro View Transitions in `Layout.astro`. Layout and multiple
route/component scripts register document- or window-level listeners and rerun
initializers after page swaps.

The home and folder pages both target the broad `.album-card` selector and both
retain `astro:after-swap` handlers. They do not share an initialization guard or
cleanup strategy. After navigating between those routes, code originating from
one page can act on cards rendered by another page.

Other components use a mixture of strategies:

- some use a `data-*Ready` guard;
- some disconnect observers during `astro:before-swap`;
- some add persistent document listeners without removing them;
- Layout owns global scroll, keyboard, navigation, and PhotoSwipe behavior.

Consequences:

- behavior depends on navigation history rather than only the current page;
- duplicate handlers and retained closures are possible;
- generic class names become implicit JavaScript APIs;
- browser-level regressions are not exercised by the current Node tests.

Recommended direction:

- establish one documented client lifecycle pattern;
- scope queries beneath component-owned root elements;
- add initialization markers and deterministic cleanup;
- use shared card behavior instead of separate home/folder implementations;
- add at least one browser navigation test covering home → folder → home and
  Album → tag → Album transitions.

### P2: Layout owns too many unrelated responsibilities

`Layout.astro` currently owns:

- navigation data loading and folder sorting;
- desktop and mobile navigation markup;
- conditional footers and RSS entry point;
- development tool loading;
- scroll-aware navbar behavior;
- keyboard navigation across content cards;
- global PhotoSwipe initialization and image dimension discovery;
- global styles and font imports.

Astro encourages colocating markup, styles, and scripts, so file length alone is
not a defect. The issue is that unrelated site services share one lifecycle and
one file. A change to the navigation shell requires reading lightbox and global
keyboard behavior, and PhotoSwipe is initialized for pages without album
photos.

Recommended direction: keep one Layout but extract focused site-level units such
as `SiteNavigation`, `SiteFooter`, and `PhotoLightbox`. Avoid turning each unit
into a framework-independent service; Astro components are sufficient.

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

Development components are conditionally imported in `Layout.astro`, which is
a good boundary. However, the mountain tag detail route conditionally renders
cover-editing controls while shipping the cover chooser client script
unconditionally. The production JavaScript bundle therefore contains session
state and a request to `/api/mountain-cover`, even though production markup has
no button that triggers it.

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

### Album data now has one normalized read boundary

The project selected and completed Option 2, the per-Album manifest design:

- each of the 67 Album MDX files has one slug-paired manifest under
  `src/album-manifests`;
- MDX frontmatter is empty and MDX owns only layout and prose;
- manifests own metadata, order, covers, photo inventory, captions, and tags;
- `src/lib/albums/catalog.ts` is the cached production read boundary used by
  home, folder pages, Layout, Album rendering, tag routes, and RSS;
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

Home, folder, Layout, tag routes, and RSS now consume normalized catalog
records. Album order and cover-key resolution are no longer reconstructed from
frontmatter, `_order.json`, and path fallbacks. Pages still perform
view-specific projections, such as selecting the latest published Album or
grouping records by folder; those are presentation policies, not duplicate
storage joins.

Album-card markup and mobile interaction remain duplicated between home and
folder routes. That residual issue belongs to the View Transition lifecycle
finding because the material risk is retained handlers and broad selectors,
not divergent Album data policy.

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

### Phase 2: Stabilize browser lifecycle

1. Define a single View Transition initialization and cleanup convention.
2. Consolidate shared Album-card behavior.
3. Scope component selectors and remove retained route-specific handlers.
4. Add browser navigation regression coverage.

The Album read model is now stable, so this phase no longer has a data-boundary
prerequisite.

### Phase 3: Reduce shell and environment coupling

1. Split focused site-level units out of Layout.
2. Isolate mountain cover editing as a development-only component.
3. Verify production bundles contain no development write endpoints.
4. Extend the root architecture and contributor documentation beyond Albums.

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
next Mountain decision is to define explicit route, index, and
profile-completeness policies. Keep the browser lifecycle, Layout extraction,
and development-only cover editor as separate work items so each can be
implemented and verified independently.

This assessment remains the shared backlog and rationale for that work.
