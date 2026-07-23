# View Transition and Layout Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make View Transition behavior deterministic across repeated navigation while reducing `Layout.astro` to a composition shell without changing visible behavior.

**Architecture:** Focused Astro components own navigation, footer, lightbox, keyboard navigation, development tools, and catalog-card behavior. A small tested lifecycle helper gives every interactive unit the same `astro:page-load` mount and idempotent cleanup contract; component code still owns its DOM and does not register with a global service.

**Tech Stack:** Astro 4, TypeScript, native `AbortController`/`EventTarget`, Node test runner, PhotoSwipe 5, Playwright Chromium.

**Design:** `docs/superpowers/specs/2026-07-23-view-transition-layout-lifecycle-design.md`

---

## File Map

**Create:**

- `src/lib/client-page-lifecycle.ts` — small mount/cleanup primitive.
- `src/lib/client-page-lifecycle.test.mjs` — lifecycle replacement and cleanup tests.
- `src/components/SiteNavigation.astro` — folder data, navigation markup, and navbar lifecycle.
- `src/components/SiteFooter.astro` — folder footer and homepage RSS rendering.
- `src/components/SiteDevTools.astro` — development-only tool loading and route policy.
- `src/components/PhotoLightbox.astro` — PhotoSwipe and image-dimension lifecycle.
- `src/components/ContentKeyboardNavigation.astro` — global arrow-key navigation over explicit targets.
- `src/components/CatalogCardInteractions.astro` — shared home/folder card behavior and cover rotation.
- `playwright.config.ts` — production-preview browser-test configuration.
- `tests/e2e/view-transition-lifecycle.spec.ts` — repeated-navigation browser regressions.

**Modify:**

- `src/layouts/Layout.astro` — compose focused units and retain only the document shell/global styling.
- `src/pages/index.astro` — explicit catalog contracts and shared interaction component.
- `src/pages/[folder]/index.astro` — explicit catalog contracts and shared interaction component.
- `src/pages/[folder]/[album].astro` — mount route behavior through the shared lifecycle contract.
- `src/pages/yama/tags/[tag].astro` — mount route behavior through the shared lifecycle contract.
- `src/components/Row.astro` — explicit keyboard/photo-row roots and abortable image sizing.
- `src/components/Photo.astro` — explicit lightbox link contract and lifecycle-safe development fallback.
- `src/components/PhotoCarousel.astro` — one page-load mount with deterministic observer/listener cleanup.
- `src/components/MountainProfile.astro` — disconnect sizing observers and cancel animation frames.
- `src/components/MountainTagGrid.astro` — root-scoped, abortable interaction listeners.
- `src/components/DevTool.astro` — use the common page-load entry point without internal redesign.
- `src/components/MountainDevTool.astro` — use the common page-load entry point without internal redesign.
- `src/lib/page-structure.test.mjs` — architecture and selector contracts.
- `package.json`, `package-lock.json` — Playwright dependency and scripts.
- `docs/superpowers/specs/2026-07-22-project-architecture-assessment.md` — resolved P1/P2 status and fresh verification.

## Task 1: Establish the Lifecycle Primitive

**Files:**

- Create: `src/lib/client-page-lifecycle.test.mjs`
- Create: `src/lib/client-page-lifecycle.ts`

- [ ] **Step 1: Write the failing replacement/cleanup tests**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { installPageLifecycle } from "./client-page-lifecycle.ts";

test("page load replaces the previous mounted behavior", () => {
    const events = new EventTarget();
    let mounts = 0;
    let cleanups = 0;
    installPageLifecycle(events, () => {
        mounts += 1;
        return () => {
            cleanups += 1;
        };
    });

    events.dispatchEvent(new Event("astro:page-load"));
    events.dispatchEvent(new Event("astro:page-load"));

    assert.equal(mounts, 2);
    assert.equal(cleanups, 1);
});

test("before-swap and uninstall clean up idempotently", () => {
    const events = new EventTarget();
    let cleanups = 0;
    const uninstall = installPageLifecycle(events, () => () => {
        cleanups += 1;
    });

    events.dispatchEvent(new Event("astro:page-load"));
    events.dispatchEvent(new Event("astro:before-swap"));
    events.dispatchEvent(new Event("astro:before-swap"));
    uninstall();
    events.dispatchEvent(new Event("astro:page-load"));

    assert.equal(cleanups, 1);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test src/lib/client-page-lifecycle.test.mjs
```

Expected: FAIL because `client-page-lifecycle.ts` does not exist.

- [ ] **Step 3: Implement the minimal lifecycle helper**

```ts
export type PageCleanup = () => void;
export type PageMount = () => void | PageCleanup;

export function installPageLifecycle(
    events: EventTarget,
    mount: PageMount,
): PageCleanup {
    let activeCleanup: PageCleanup | undefined;

    const cleanup = () => {
        const current = activeCleanup;
        activeCleanup = undefined;
        current?.();
    };
    const pageLoad = () => {
        cleanup();
        activeCleanup = mount() || undefined;
    };

    events.addEventListener("astro:page-load", pageLoad);
    events.addEventListener("astro:before-swap", cleanup);

    return () => {
        events.removeEventListener("astro:page-load", pageLoad);
        events.removeEventListener("astro:before-swap", cleanup);
        cleanup();
    };
}
```

- [ ] **Step 4: Run focused and full tests**

Run:

```bash
node --test src/lib/client-page-lifecycle.test.mjs
npm test
```

Expected: both focused lifecycle tests PASS; the full suite reports 34 test
files passing.

- [ ] **Step 5: Commit**

```bash
git add src/lib/client-page-lifecycle.ts src/lib/client-page-lifecycle.test.mjs
git commit -m "feat: add client page lifecycle contract"
```

## Task 2: Extract the Server-Rendered Layout Boundaries

**Files:**

- Create: `src/components/SiteFooter.astro`
- Create: `src/components/SiteDevTools.astro`
- Modify: `src/layouts/Layout.astro`
- Modify: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Add a failing Layout ownership test**

Append:

```js
test("Layout composes focused site units", () => {
    const layout = readProjectFile("src/layouts/Layout.astro");

    for (const component of [
        "SiteFooter",
        "SiteDevTools",
    ]) {
        assert.match(layout, new RegExp(`import ${component} from`));
        assert.match(layout, new RegExp(`<${component}`));
    }
    assert.doesNotMatch(layout, /DevTool\\.astro|MountainDevTool\\.astro/);
    assert.doesNotMatch(layout, /folderFooter|rss\\.xml/);
});
```

- [ ] **Step 2: Run the structure test and verify RED**

Run:

```bash
node --test src/lib/page-structure.test.mjs
```

Expected: FAIL because the focused components are not imported.

- [ ] **Step 3: Extract `SiteFooter.astro`**

Move the existing folder-footer and homepage RSS markup unchanged. Resolve the
policy inside the component:

```astro
---
import { getFolderFooter } from "../lib/constants";

const currentPath = Astro.url.pathname;
const currentFolder = currentPath.split("/").filter(Boolean)[0];
const folderFooter = currentFolder ? getFolderFooter(currentFolder) : null;
---

{folderFooter && (
    <footer class="py-12 border-t border-white/5">
        <div class="mx-auto max-w-[1100px] px-4 sm:px-8 text-center">
            <p class="text-zinc-500 font-sans tracking-[0.3em] text-sm">
                {folderFooter}
            </p>
        </div>
    </footer>
)}

{currentPath === "/" && (
    <footer class="pb-8">
        <div class="mx-auto flex max-w-[1100px] justify-end px-4 sm:px-8">
            <a
                href="/rss.xml"
                class="flex h-7 w-7 items-center justify-center rounded-full border border-white/10 text-zinc-500 transition-colors hover:border-white/30 hover:text-white"
                aria-label="Subscribe to RIVERBED RSS"
                title="Subscribe to RSS"
            >
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                >
                    <path d="M4 11a9 9 0 0 1 9 9" />
                    <path d="M4 4a16 16 0 0 1 16 16" />
                    <circle cx="5" cy="19" r="1" />
                </svg>
            </a>
        </div>
    </footer>
)}
```

- [ ] **Step 4: Extract `SiteDevTools.astro`**

Use the existing development-only imports and route condition without changing
either tool:

```astro
---
const DevTool = import.meta.env.DEV
    ? (await import("./DevTool.astro")).default
    : null;
const MountainDevTool = import.meta.env.DEV
    ? (await import("./MountainDevTool.astro")).default
    : null;
const isMountainTagRoute = Astro.url.pathname.startsWith("/yama/tags/");
---

{DevTool && (
    <>
        <DevTool />
        {MountainDevTool && isMountainTagRoute && <MountainDevTool />}
    </>
)}
```

- [ ] **Step 5: Compose the extracted units from Layout**

Render `SiteFooter` after `<main>` and `SiteDevTools` after the footer. Leave
navigation/lightbox/keyboard implementation untouched until their individual
RED tests are written in Tasks 3, 5, and 6.

- [ ] **Step 6: Run tests and Astro check**

Run:

```bash
node --test src/lib/page-structure.test.mjs
npm exec astro check
```

Expected: structure tests PASS; Astro check has 0 errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/SiteFooter.astro src/components/SiteDevTools.astro src/layouts/Layout.astro src/lib/page-structure.test.mjs
git commit -m "refactor: extract layout rendering boundaries"
```

## Task 3: Move Navigation Into an Owned Lifecycle

**Files:**

- Create: `src/components/SiteNavigation.astro`
- Modify: `src/layouts/Layout.astro`
- Modify: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Add failing navigation ownership assertions**

```js
test("SiteNavigation owns navbar data, markup, and lifecycle", () => {
    const layout = readProjectFile("src/layouts/Layout.astro");
    const navigation = readProjectFile("src/components/SiteNavigation.astro");

    assert.doesNotMatch(layout, /getAlbumSummaries|menu-toggle|initNavbar/);
    assert.match(navigation, /getAlbumSummaries/);
    assert.match(navigation, /data-site-navigation/);
    assert.match(navigation, /installPageLifecycle/);
    assert.match(navigation, /AbortController/);
    assert.doesNotMatch(navigation, /astro:after-swap/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test src/lib/page-structure.test.mjs
```

Expected: FAIL because Layout still owns navigation.

- [ ] **Step 3: Move server data and markup to `SiteNavigation.astro`**

Move the existing folder discovery/sort and desktop/mobile navigation markup
without changing classes, labels, hrefs, or order. Add only behavior contracts:

```astro
<nav
    id="navbar"
    data-site-navigation
    class="fixed top-0 left-0 right-0 z-50 bg-[#121212]/80 transition-transform duration-300 ease-in-out"
>
```

Add `data-site-menu-toggle` to the existing `id="menu-toggle"` button and
`data-site-mobile-menu` to the existing `id="mobile-menu"` element. The
frontmatter moved from Layout is:

```ts
import { getAlbumSummaries } from "../lib/albums/catalog";
import {
    FOLDER_METADATA,
    getFolderOrder,
    getFolderTitle,
} from "../lib/constants";

const metadataSlugs = Object.keys(FOLDER_METADATA);
const albums = await getAlbumSummaries();
const albumFolderSlugs = albums.map((album) => album.folder);
const folderSlugs = [...new Set([...metadataSlugs, ...albumFolderSlugs])];
const sortedFolders = folderSlugs
    .map((slug) => ({
        id: slug,
        title: getFolderTitle(slug),
        order: getFolderOrder(slug),
    }))
    .sort((left, right) => left.order - right.order);
const currentPath = Astro.url.pathname;
```

- [ ] **Step 4: Implement abortable navbar behavior**

Use the lifecycle helper and preserve the existing scroll/menu behavior:

```ts
import { installPageLifecycle } from "../lib/client-page-lifecycle";

installPageLifecycle(document, () => {
    const root = document.querySelector<HTMLElement>("[data-site-navigation]");
    if (!root) return;

    const controller = new AbortController();
    const toggle = root.querySelector<HTMLButtonElement>(
        "[data-site-menu-toggle]",
    );
    const menu = root.querySelector<HTMLElement>("[data-site-mobile-menu]");
    if (!toggle || !menu) return () => controller.abort();

    let lastScrollY = window.scrollY;
    let closeTimer: number | undefined;

    const setMenuOpen = (open: boolean) => {
        if (closeTimer !== undefined) window.clearTimeout(closeTimer);
        if (open) {
            menu.classList.remove("hidden");
            void menu.offsetWidth;
            menu.style.maxHeight = "500px";
        } else {
            menu.style.maxHeight = "0px";
            closeTimer = window.setTimeout(() => {
                menu.classList.add("hidden");
            }, 300);
        }
        toggle.querySelector(".menu-icon")?.classList.toggle("hidden", open);
        toggle.querySelector(".close-icon")?.classList.toggle("hidden", !open);
    };

    toggle.addEventListener("click", () => {
        setMenuOpen(menu.classList.contains("hidden"));
    }, { signal: controller.signal });

    window.addEventListener("scroll", () => {
        const currentScrollY = window.scrollY;
        if (!menu.classList.contains("hidden")) setMenuOpen(false);
        root.classList.toggle(
            "-translate-y-full",
            currentScrollY > lastScrollY && currentScrollY > 120,
        );
        lastScrollY = currentScrollY;
    }, { passive: true, signal: controller.signal });

    return () => {
        controller.abort();
        if (closeTimer !== undefined) window.clearTimeout(closeTimer);
    };
});
```

Remove the clone-and-replace listener workaround because deterministic cleanup
makes it unnecessary.

- [ ] **Step 5: Remove navigation code/data from Layout and compose the component**

`Layout.astro` should render `<SiteNavigation />` before `<main>`, with no folder
catalog imports or navbar script.

- [ ] **Step 6: Run focused tests and Astro check**

Run:

```bash
node --test src/lib/client-page-lifecycle.test.mjs src/lib/page-structure.test.mjs
npm exec astro check
```

Expected: PASS; 0 Astro errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/SiteNavigation.astro src/layouts/Layout.astro src/lib/page-structure.test.mjs
git commit -m "refactor: give site navigation an owned lifecycle"
```

## Task 4: Share Catalog Card Behavior

**Files:**

- Create: `src/components/CatalogCardInteractions.astro`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/[folder]/index.astro`
- Modify: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Add failing shared-behavior assertions**

```js
test("home and folder catalogs share root-scoped card behavior", () => {
    const home = readProjectFile("src/pages/index.astro");
    const folder = readProjectFile("src/pages/[folder]/index.astro");
    const behavior = readProjectFile("src/components/CatalogCardInteractions.astro");

    for (const route of [home, folder]) {
        assert.match(route, /data-catalog-grid/);
        assert.match(route, /data-catalog-card/);
        assert.match(route, /<CatalogCardInteractions/);
        assert.doesNotMatch(route, /astro:after-swap|init(?:Folder|Album)Cards/);
    }
    assert.match(behavior, /installPageLifecycle/);
    assert.match(behavior, /root\\.querySelectorAll/);
    assert.doesNotMatch(behavior, /document\\.querySelectorAll\\([^)]*album-card/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test src/lib/page-structure.test.mjs
```

Expected: FAIL because each route owns a persistent card initializer.

- [ ] **Step 3: Add explicit catalog contracts**

Add `data-catalog-grid` to the existing home `<nav>` and folder grid. Add
`data-catalog-card` and `data-keyboard-navigation-target` to every interactive
catalog card. Keep existing classes unchanged.

- [ ] **Step 4: Implement the shared interaction component**

```ts
installPageLifecycle(document, () => {
    const root = document.querySelector<HTMLElement>("[data-catalog-grid]");
    if (!root) return;

    const controller = new AbortController();
    const cards = Array.from(
        root.querySelectorAll<HTMLElement>("[data-catalog-card]"),
    );
    const intervals: number[] = [];
    const closeCards = () => {
        cards.forEach((card) => card.classList.remove("show-info"));
    };

    for (const card of cards) {
        const slides = card.querySelectorAll<HTMLElement>(".slide");
        if (slides.length > 1) {
            let current = 0;
            intervals.push(window.setInterval(() => {
                slides[current].classList.remove("active");
                current = (current + 1) % slides.length;
                slides[current].classList.add("active");
            }, 5_000));
        }
        card.addEventListener("click", (event) => {
            const isMobile = window.matchMedia(
                "(max-width: 768px) and (hover: none)",
            ).matches;
            if (!isMobile || card.classList.contains("show-info")) return;
            event.preventDefault();
            closeCards();
            card.classList.add("show-info");
        }, {
            signal: controller.signal,
        });
    }
    document.addEventListener("click", (event) => {
        const target = event.target;
        const card = target instanceof Element
            ? target.closest("[data-catalog-card]")
            : null;
        if (!card || !root.contains(card)) {
            closeCards();
        }
    }, {
        signal: controller.signal,
    });

    return () => {
        controller.abort();
        intervals.forEach((interval) => window.clearInterval(interval));
    };
});
```

The handlers preserve first-tap reveal/second-tap navigation and close only
cards belonging to the current root.

- [ ] **Step 5: Delete both route-local scripts and render the shared component**

Import and render `<CatalogCardInteractions />` once per route after the catalog
markup.

- [ ] **Step 6: Run tests and build**

Run:

```bash
node --test src/lib/page-structure.test.mjs
npm exec astro check
npm run build
```

Expected: all checks PASS; build still generates 356 pages.

- [ ] **Step 7: Commit**

```bash
git add src/components/CatalogCardInteractions.astro src/pages/index.astro 'src/pages/[folder]/index.astro' src/lib/page-structure.test.mjs
git commit -m "refactor: share catalog card interactions"
```

## Task 5: Extract Explicit Keyboard Navigation

**Files:**

- Create: `src/components/ContentKeyboardNavigation.astro`
- Modify: `src/layouts/Layout.astro`
- Modify: `src/components/Row.astro`
- Modify: `src/pages/index.astro`
- Modify: `src/pages/[folder]/index.astro`
- Modify: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Add failing keyboard-contract assertions**

```js
test("keyboard navigation uses explicit targets outside Layout", () => {
    const layout = readProjectFile("src/layouts/Layout.astro");
    const keyboard = readProjectFile("src/components/ContentKeyboardNavigation.astro");
    const row = readProjectFile("src/components/Row.astro");

    assert.doesNotMatch(layout, /ArrowRight|\\.photo-row, \\.album-card/);
    assert.match(keyboard, /data-keyboard-navigation-target/);
    assert.match(keyboard, /installPageLifecycle/);
    assert.match(keyboard, /AbortController/);
    assert.match(row, /data-keyboard-navigation-target/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test src/lib/page-structure.test.mjs
```

Expected: FAIL because Layout still owns keyboard behavior.

- [ ] **Step 3: Add the target contract without changing styling**

Add `data-keyboard-navigation-target` to `.photo-row` and the catalog cards
already touched in Task 4.

- [ ] **Step 4: Move the existing algorithm into `ContentKeyboardNavigation.astro`**

Keep the editable/dialog guard and scroll offsets. Replace the broad selector:

```ts
const targets = Array.from(
    document.querySelectorAll<HTMLElement>(
        "[data-keyboard-navigation-target]",
    ),
);
```

Install the `keydown` handler with an `AbortController` returned from
`installPageLifecycle`.

- [ ] **Step 5: Remove keyboard code from Layout and render the component**

Place `<ContentKeyboardNavigation />` once in the body after the main content.

- [ ] **Step 6: Run focused tests and Astro check**

Run:

```bash
node --test src/lib/client-page-lifecycle.test.mjs src/lib/page-structure.test.mjs
npm exec astro check
```

Expected: PASS; 0 Astro errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ContentKeyboardNavigation.astro src/components/Row.astro src/layouts/Layout.astro src/pages/index.astro 'src/pages/[folder]/index.astro' src/lib/page-structure.test.mjs
git commit -m "refactor: extract content keyboard navigation"
```

## Task 6: Extract PhotoSwipe and Clean Up Media Lifecycles

**Files:**

- Create: `src/components/PhotoLightbox.astro`
- Modify: `src/layouts/Layout.astro`
- Modify: `src/components/Photo.astro`
- Modify: `src/components/Row.astro`
- Modify: `src/components/PhotoCarousel.astro`
- Modify: `src/components/MountainProfile.astro`
- Modify: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Add failing lightbox/media ownership assertions**

```js
test("PhotoLightbox owns PhotoSwipe and media components clean up", () => {
    const layout = readProjectFile("src/layouts/Layout.astro");
    const lightbox = readProjectFile("src/components/PhotoLightbox.astro");
    const carousel = readProjectFile("src/components/PhotoCarousel.astro");
    const profile = readProjectFile("src/components/MountainProfile.astro");

    assert.doesNotMatch(layout, /PhotoSwipeLightbox|pswp-link|initDimensions/);
    assert.match(lightbox, /PhotoSwipeLightbox/);
    assert.match(lightbox, /installPageLifecycle/);
    assert.match(lightbox, /lightbox\\.destroy/);
    assert.doesNotMatch(carousel, /astro:after-swap/);
    assert.match(profile, /resizeObserver\\.disconnect/);
    assert.match(profile, /panelObserver\\.disconnect/);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test src/lib/page-structure.test.mjs
```

Expected: FAIL because PhotoSwipe remains in Layout and observers are retained.

- [ ] **Step 3: Implement `PhotoLightbox.astro`**

Move the existing gallery selector and dimension behavior. Scope dimension
queries to supported current galleries and make listeners abortable:

```ts
import PhotoSwipeLightbox from "photoswipe/lightbox";
import { installPageLifecycle } from "../lib/client-page-lifecycle";

const hydrateDimensions = (
    links: Iterable<HTMLAnchorElement>,
    signal: AbortSignal,
) => {
    for (const link of links) {
        const image = link.querySelector("img");
        if (!image) continue;
        const apply = () => {
            if (!image.naturalWidth || !image.naturalHeight) return;
            link.dataset.pswpWidth = String(image.naturalWidth);
            link.dataset.pswpHeight = String(image.naturalHeight);
        };
        if (image.complete) apply();
        else image.addEventListener("load", apply, { signal });
    }
};

installPageLifecycle(document, () => {
    const links = document.querySelectorAll<HTMLAnchorElement>(
        "[data-photo-lightbox-link]",
    );
    if (links.length === 0) return;

    const controller = new AbortController();
    hydrateDimensions(links, controller.signal);
    const lightbox = new PhotoSwipeLightbox({
        gallery: ".album-content, .tag-photos, .pswp-gallery, .prose",
        children: "[data-photo-lightbox-link]",
        pswpModule: () => import("photoswipe"),
    });
    lightbox.on("beforeOpen", () => hydrateDimensions(links, controller.signal));
    lightbox.init();

    return () => {
        controller.abort();
        lightbox.destroy();
    };
});
```

Add `data-photo-lightbox-link` to the existing Photo link while retaining
`.pswp-link`.

- [ ] **Step 4: Make Row and Photo fallback listeners lifecycle-safe**

Give each row `data-photo-row`, query rows from current document on page-load,
attach image load/error listeners with an `AbortController`, and remove both
immediate calls plus `astro:after-swap`.

- [ ] **Step 5: Convert PhotoCarousel to the shared lifecycle**

Return one cleanup that disconnects every created observer, removes captured
slide click listeners through an abort signal, clears initial-position timers,
and removes `data-carousel-ready`. Replace immediate/before/after wiring with
`installPageLifecycle`.

- [ ] **Step 6: Clean up MountainProfile observers**

Collect each profile's `ResizeObserver`, `MutationObserver`, and pending
animation-frame ID in the mount. Cleanup disconnects observers, cancels frames,
and removes the two sizing CSS properties. Replace the retained
`astro:after-swap` entry with `installPageLifecycle`.

- [ ] **Step 7: Remove PhotoSwipe/media code from Layout and compose PhotoLightbox**

`Layout.astro` imports and renders `<PhotoLightbox />`; no `photoswipe/lightbox`
import remains in Layout.

- [ ] **Step 8: Run tests, check, and build**

Run:

```bash
node --test src/lib/client-page-lifecycle.test.mjs src/lib/page-structure.test.mjs
npm exec astro check
npm run build
```

Expected: PASS; 0 Astro errors; 356 pages.

- [ ] **Step 9: Commit**

```bash
git add src/components/PhotoLightbox.astro src/components/Photo.astro src/components/Row.astro src/components/PhotoCarousel.astro src/components/MountainProfile.astro src/layouts/Layout.astro src/lib/page-structure.test.mjs
git commit -m "refactor: give media behavior deterministic cleanup"
```

## Task 7: Normalize Remaining Covered Route Lifecycles

**Files:**

- Modify: `src/pages/[folder]/[album].astro`
- Modify: `src/pages/yama/tags/[tag].astro`
- Modify: `src/components/MountainTagGrid.astro`
- Modify: `src/components/DevTool.astro`
- Modify: `src/components/MountainDevTool.astro`
- Modify: `src/lib/page-structure.test.mjs`

- [ ] **Step 1: Add a failing retained-listener guard**

```js
test("covered client scripts do not retain after-swap initializers", () => {
    const paths = [
        "src/pages/[folder]/[album].astro",
        "src/pages/yama/tags/[tag].astro",
        "src/components/MountainTagGrid.astro",
        "src/components/DevTool.astro",
        "src/components/MountainDevTool.astro",
        "src/components/Photo.astro",
        "src/components/Row.astro",
        "src/components/PhotoCarousel.astro",
        "src/components/MountainProfile.astro",
    ];
    for (const path of paths) {
        assert.doesNotMatch(
            readProjectFile(path),
            /addEventListener\\(["']astro:after-swap/,
            path,
        );
    }
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test src/lib/page-structure.test.mjs
```

Expected: FAIL and list the remaining files with retained initializers.

- [ ] **Step 3: Convert Album route behavior to one mount**

Keep breadcrumb, tag-toggle, and scroll algorithms unchanged. During mount:

- create one `AbortController`;
- create the current `IntersectionObserver`;
- bind button/scroll handlers with its signal;
- run initial synchronization once.

Cleanup aborts listeners, disconnects the breadcrumb observer, and resets the
route-local `areAllTagsVisible` state.

The entry point becomes:

```ts
installPageLifecycle(document, () => {
    const controller = new AbortController();
    areAllTagsVisible = false;
    const breadcrumbObserver = initAlbumBreadcrumbs();
    initAlbumTagToggle(controller.signal);
    handleScroll();
    window.addEventListener("scroll", handleScroll, {
        passive: true,
        signal: controller.signal,
    });

    return () => {
        controller.abort();
        breadcrumbObserver?.disconnect();
        areAllTagsVisible = false;
    };
});
```

Change `initAlbumBreadcrumbs` to return its observer (or `undefined`) and
`initAlbumTagToggle` to attach its click handler with the received signal
instead of assigning `onclick`.

- [ ] **Step 4: Convert Mountain tag route behavior to one mount**

Keep cover chooser and scroll behavior unchanged. Bind current-page controls
with an abort signal, clear the cover-reset timeout, and avoid production work
when no development cover controls exist.

Use one entry point:

```ts
installPageLifecycle(document, () => {
    const controller = new AbortController();
    resetCoverSaveScrollPosition();
    const clearCoverChooser = initMountainCoverChooser(controller.signal);
    handleScroll();
    window.addEventListener("scroll", handleScroll, {
        passive: true,
        signal: controller.signal,
    });
    return () => {
        controller.abort();
        clearCoverChooser?.();
    };
});
```

`initMountainCoverChooser` returns immediately when the development-only cover
button is absent and otherwise returns a function that clears its scroll-reset
timer.

- [ ] **Step 5: Scope MountainTagGrid listeners to its current root**

Use `installPageLifecycle`, query from the explicit existing grid root, attach
button/card/document listeners with an abort signal, and remove transient
`show-info` state during cleanup.

Add `data-mountain-tag-grid` to the grid root and begin the mount with:

```ts
const root = document.querySelector<HTMLElement>("[data-mountain-tag-grid]");
if (!root) return;
const controller = new AbortController();
const cards = Array.from(
    root.querySelectorAll<HTMLElement>(".mountain-tag-card"),
);
```

All `button`, `pointerenter`, `focusin`, `click`, and document outside-click
listeners receive `{ signal: controller.signal }`. Cleanup aborts the controller
and removes `show-info` from `cards`.

- [ ] **Step 6: Normalize development-tool entry events only**

Replace the bottom-level immediate call plus `astro:after-swap` registration
with these exact entry points:

```ts
installPageLifecycle(document, () => {
    init();
});
```

in `DevTool.astro`, and:

```ts
installPageLifecycle(document, () => {
    initMountainManager();
});
```

in `MountainDevTool.astro`. Do not restructure tool features, storage, dialogs,
or editing workflows.

- [ ] **Step 7: Run the retained-listener guard and full tests**

Run:

```bash
node --test src/lib/page-structure.test.mjs
npm test
npm exec astro check
```

Expected: all tests PASS; Astro has 0 errors.

- [ ] **Step 8: Commit**

```bash
git add 'src/pages/[folder]/[album].astro' 'src/pages/yama/tags/[tag].astro' src/components/MountainTagGrid.astro src/components/DevTool.astro src/components/MountainDevTool.astro src/lib/page-structure.test.mjs
git commit -m "refactor: normalize route client lifecycles"
```

## Task 8: Add Production Browser Navigation Tests

**Files:**

- Create: `playwright.config.ts`
- Create: `tests/e2e/view-transition-lifecycle.spec.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install Playwright test support**

Run:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium
```

Expected: dependency and Chromium install successfully. Do not run
`npm audit fix`.

- [ ] **Step 2: Add production-preview scripts**

Add:

```json
{
  "scripts": {
    "pretest:e2e": "npm run build",
    "test:e2e": "playwright test"
  }
}
```

- [ ] **Step 3: Create `playwright.config.ts`**

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    retries: process.env.CI ? 2 : 0,
    reporter: "list",
    use: {
        baseURL: "http://127.0.0.1:4321",
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
    },
    webServer: {
        command: "npm run preview -- --host 127.0.0.1",
        url: "http://127.0.0.1:4321",
        reuseExistingServer: !process.env.CI,
    },
});
```

- [ ] **Step 4: Write the mobile catalog/navigation regression**

Use a Pixel-like touch context. Repeat `/` → `/yama` → `/` through visible
links, then verify:

```ts
await expect(page.locator("[data-site-navigation]")).toBeVisible();
await page.locator("[data-site-menu-toggle]").click();
await expect(page.locator("[data-site-mobile-menu]")).not.toHaveClass(/hidden/);

const yamaCard = page.locator(
    '[data-catalog-card]:has(a[href="/yama"])',
).first();
await yamaCard.click();
await expect(page).toHaveURL("/");
await expect(yamaCard).toHaveClass(/show-info/);
await yamaCard.click();
await expect(page).toHaveURL(/\/yama\/?$/);
```

Return through the RIVERBED logo, repeat, and assert the first tap still reveals
instead of navigating. This catches accumulated card handlers.

- [ ] **Step 5: Write the Album/tag/lightbox regression**

Use `/yama/2024-beinandawu`, which has stored Mountain tags. Fulfill remote
image requests with a fixed 1×1 PNG so the test is independent of R2:

```ts
await page.goto("/yama/2024-beinandawu");
await page.locator("#toggle-all-tags").click();
await page.locator(".tag-link").first().click();
await expect(page).toHaveURL(/\/yama\/tags\//);
await page.goBack();
await expect(page).toHaveURL(/\/yama\/2024-beinandawu\/?$/);

await page.locator("[data-photo-lightbox-link]").first().click();
await expect(page.locator(".pswp")).toHaveCount(1);
await page.locator(".pswp__button--close").click();
await expect(page.locator(".pswp")).toHaveCount(0);
```

Repeat tag/back navigation before opening the lightbox a second time and keep
the `.pswp` count at one.

- [ ] **Step 6: Write the single keyboard-response regression**

After repeated home/folder navigation, instrument `window.scrollTo`, reset the
counter, press `ArrowDown`, and assert exactly one call:

```ts
await page.evaluate(() => {
    const original = window.scrollTo.bind(window);
    Object.assign(window, { __riverbedScrollCalls: 0 });
    window.scrollTo = (...args) => {
        window.__riverbedScrollCalls += 1;
        original(...args);
    };
});
await page.keyboard.press("ArrowDown");
await expect.poll(() =>
    page.evaluate(() => window.__riverbedScrollCalls),
).toBe(1);
```

Declare the test-only `Window.__riverbedScrollCalls` type in the spec file.

- [ ] **Step 7: Run Playwright and verify GREEN**

Run:

```bash
npm run test:e2e
```

Expected: all lifecycle browser tests PASS against the production preview.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json playwright.config.ts tests/e2e/view-transition-lifecycle.spec.ts
git commit -m "test: cover view transition navigation"
```

## Task 9: Reassess Architecture and Verify the Branch

**Files:**

- Modify: `docs/superpowers/specs/2026-07-22-project-architecture-assessment.md`

- [ ] **Step 1: Update the assessment**

Move “View Transition client lifecycle is globally coupled” and “Layout owns
too many unrelated responsibilities” into the resolved section. Record:

- the `astro:page-load`/cleanup contract;
- focused Layout components;
- explicit DOM behavior contracts;
- shared card behavior;
- Playwright production-navigation coverage.

Keep Mountain route policy and production DevTool isolation as separate open
findings.

- [ ] **Step 2: Run all Node tests**

Run:

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 3: Run Astro diagnostics**

Run:

```bash
npm exec astro check
```

Expected: 0 errors. Existing unrelated hints may remain.

- [ ] **Step 4: Run the production build**

Run:

```bash
npm run build
```

Expected: build succeeds and generates 356 pages.

- [ ] **Step 5: Run production browser tests**

Run:

```bash
npm run test:e2e
```

Expected: all Playwright tests PASS.

- [ ] **Step 6: Check the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the assessment is uncommitted.

- [ ] **Step 7: Commit the assessment**

```bash
git add docs/superpowers/specs/2026-07-22-project-architecture-assessment.md
git commit -m "docs: reassess client lifecycle architecture"
```

- [ ] **Step 8: Request code review**

Use `superpowers:requesting-code-review` against the base commit before
implementation, with emphasis on:

- listener/observer/timer leaks after repeated navigation;
- accidental visual or interaction changes;
- PhotoSwipe instance cleanup;
- production-only behavior;
- Playwright test reliability and selector stability.
