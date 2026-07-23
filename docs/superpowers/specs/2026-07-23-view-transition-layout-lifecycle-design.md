# View Transition and Layout Lifecycle Design

**Date:** 2026-07-23

**Status:** Approved design, pending implementation plan

## Goal

Make client behavior depend only on the currently rendered page, even after
repeated Astro View Transition navigation, while reducing `Layout.astro` to a
small site shell with focused component-owned responsibilities.

This is a behavior-preserving refactor. Navigation appearance, mobile menu
behavior, card interaction, keyboard scrolling, PhotoSwipe behavior, footers,
and development tools must remain visibly and functionally unchanged.

## Problems Being Solved

The current site mixes immediate initialization, `astro:after-swap`,
`astro:page-load`, and occasional `astro:before-swap` cleanup. Several scripts
retain document or window listeners after their route markup has gone away.
Home and folder routes both query broad card selectors, so code from a
previously visited route can act on the current route.

`Layout.astro` also owns unrelated data loading, navigation markup, footers,
development tools, navbar behavior, keyboard navigation, PhotoSwipe, image
dimension discovery, fonts, and global styles. The problem is not file length
alone; these responsibilities have different lifecycle and dependency needs
but currently share one file and initialization path.

## Chosen Approach

Use component-owned lifecycle with focused Astro components. Do not introduce a
global lifecycle registry or a framework-independent service layer.

Each interactive site-level component owns:

- one explicit DOM root or behavior marker;
- initialization on `astro:page-load`;
- deterministic cleanup before replacement;
- queries scoped to its root whenever the behavior is component-local.

Pure rendering components do not ship client scripts.

## Component Boundaries

### `Layout.astro`

Keep only:

- the HTML document, `<head>`, and `<ViewTransitions />`;
- global font and stylesheet imports;
- composition of site-level components;
- the main content `<slot />`;
- styles that are genuinely global.

Layout must not implement navbar interaction, keyboard navigation, PhotoSwipe,
image dimension discovery, footer policy, or development-tool route policy.

### `SiteNavigation.astro`

Own:

- Album folder discovery and sorting;
- desktop and mobile navigation markup;
- active-folder presentation;
- mobile menu open/close behavior;
- scroll-aware navbar visibility.

Its script binds only to the current navigation root. Window listeners are
registered with an `AbortController` and released before the next page is
initialized. Pending menu-close timers are cleared during cleanup.

### `SiteFooter.astro`

Own:

- folder-specific footer text;
- the homepage RSS entry point.

It is server-rendered and has no client lifecycle.

### `PhotoLightbox.astro`

Own:

- PhotoSwipe creation and destruction;
- discovery of supported gallery roots;
- missing image-dimension hydration;
- image `load` listeners used for dimensions.

If the current page has no supported gallery links, it does not create a
PhotoSwipe instance. All selectors are evaluated against current-page roots,
and cleanup destroys the instance and aborts pending listeners.

### `ContentKeyboardNavigation.astro`

Own:

- arrow-key scrolling between page content targets;
- ignoring input, textarea, select, dialog, editable, and textbox contexts.

Targets use an explicit `data-keyboard-navigation-target` contract. CSS classes
remain presentation-only and are not the behavior API.

### `SiteDevTools.astro`

Own:

- development-only dynamic imports;
- rendering the general DevTool;
- rendering MountainDevTool only on Mountain tag routes.

This extraction does not refactor either tool's internal behavior.

### Shared catalog-card behavior

Home and folder catalog markup use the same card-interaction implementation.
The implementation locates a current `[data-catalog-grid]` root and queries
only cards below that root. It replaces the two route-specific persistent
document handlers while preserving existing mouse and touch behavior.

## Lifecycle Contract

`astro:page-load` is the single initialization event for behavior covered by
this design. It runs for the first document and after View Transition
navigation.

Each interactive unit keeps at most one active cleanup function:

1. When `astro:page-load` fires, run the previous cleanup if present.
2. Query the current component root.
3. If the root is absent, keep no active behavior.
4. Otherwise, attach the current behavior and retain its cleanup function.
5. On `astro:before-swap`, run cleanup and clear the retained function.

Cleanup is idempotent. Calling it more than once must not throw.

Use `AbortController` for event listeners where supported. Explicitly
disconnect observers, destroy PhotoSwipe, and clear timers or element-owned
state that cannot be handled by aborting listeners.

Covered route and component scripts must not combine immediate initialization
with an `astro:after-swap` listener. Scripts outside the approved scope are
changed only when they violate the same lifecycle during the required browser
navigation paths.

## DOM Behavior Contracts

Introduce explicit data attributes for JavaScript-owned behavior:

- `data-site-navigation`
- `data-catalog-grid`
- `data-catalog-card`
- `data-keyboard-navigation-target`
- existing PhotoSwipe link/gallery attributes where they are already specific

Selectors must be scoped to the owning root unless the behavior is inherently
site-global, such as keyboard navigation. Site-global behavior may query only
the explicit data contract, never generic styling classes.

The refactor must not change classes used for styling, URLs, navigation order,
visible labels, transitions, or accessibility labels.

## Error Handling

- Missing roots are normal and produce a no-op.
- A page without PhotoSwipe links does not initialize a lightbox.
- Missing or not-yet-loaded image dimensions are populated after image load.
- Cleanup tolerates already-removed DOM.
- Initialization failure in one focused unit must not prevent unrelated static
  page content from rendering.
- Playwright failures retain trace and screenshot artifacts for diagnosis.

## Testing Strategy

### Node tests

Extend repository structure tests to enforce:

- `Layout.astro` composes focused units and no longer contains PhotoSwipe,
  keyboard-navigation, navbar-interaction, footer-policy, or DevTool logic;
- home and folder routes share catalog-card behavior;
- covered route scripts do not retain `astro:after-swap` handlers;
- behavior selectors use explicit data contracts rather than broad styling
  classes.

Add focused lifecycle tests for initialization replacement and idempotent
cleanup where the implementation can be tested with platform `EventTarget`
objects without adding a DOM emulation framework.

### Playwright tests

Add `@playwright/test` as a development dependency and run against a production
build served by `astro preview`.

Cover at least:

1. home → folder → home, repeated;
2. catalog-card interaction still changes state once per action;
3. mobile navigation still opens and closes after repeated navigation;
4. Album → tag → Album;
5. PhotoSwipe opens one dialog and leaves no active overlay after close;
6. arrow-key navigation causes one navigation scroll response after repeated
   page transitions.

Use stable explicit data attributes for test locators. Do not make Playwright
depend on animation timing when a semantic state or DOM condition is
available.

## Scope

Included:

- the View Transition lifecycle used by the required navigation paths;
- extraction of the five focused site-level units;
- shared home/folder card behavior;
- browser regression infrastructure and tests;
- architecture documentation updates.

Excluded:

- visual redesign or interaction changes;
- refactoring the internals of DevTool or MountainDevTool;
- Mountain route, index, or profile-completeness policy;
- changing Album or Mountain data ownership;
- a general client lifecycle framework;
- unrelated dependency upgrades or `npm audit fix`.

## Acceptance Criteria

- Existing visible behavior remains unchanged.
- Repeated View Transition navigation does not accumulate active handlers,
  observers, timers, or PhotoSwipe instances in covered flows.
- Behavior is selected by current component roots and explicit data contracts,
  not navigation history or generic CSS classes.
- `Layout.astro` is a composition shell rather than the owner of unrelated
  client services.
- Existing Node tests, Astro type checks, and the production build pass.
- New Playwright navigation tests pass against the production preview.

