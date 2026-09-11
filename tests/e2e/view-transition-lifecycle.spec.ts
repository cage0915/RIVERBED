import { devices, expect, test, type Page } from "@playwright/test";

declare global {
    interface Window {
        __riverbedScrollCalls: number;
        pswp?: {
            opener: {
                isOpen: boolean;
                isOpening: boolean;
            };
        };
    }
}

const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9ZJkAAAAASUVORK5CYII=",
    "base64",
);
const PIXEL_5_TOUCH = {
    viewport: devices["Pixel 5"].viewport,
    userAgent: devices["Pixel 5"].userAgent,
    deviceScaleFactor: devices["Pixel 5"].deviceScaleFactor,
    isMobile: devices["Pixel 5"].isMobile,
    hasTouch: devices["Pixel 5"].hasTouch,
};

async function isolateRemotePhotos(page: Page) {
    await page.route("https://photos.cage0915.com/**", async (route) => {
        await route.fulfill({
            status: 200,
            contentType: "image/png",
            body: ONE_PIXEL_PNG,
        });
    });
}

async function openYamaFromHomeWithTouch(page: Page) {
    const yamaCard = page.locator(
        '[data-catalog-card]:has(a[href="/yama"])',
    ).first();

    await expect(yamaCard).toBeVisible();
    await yamaCard.click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect(yamaCard).toHaveClass(/show-info/);

    await yamaCard.click();
    await expect(page).toHaveURL(/\/yama\/?$/);
    await expect(page.locator("[data-site-navigation]")).toBeVisible();
}

async function expectHiddenClass(
    locator: ReturnType<Page["locator"]>,
    hidden: boolean,
) {
    await expect.poll(() =>
        locator.evaluate((element) => element.classList.contains("hidden")),
    ).toBe(hidden);
}

async function waitForPhotoSwipeOpen(page: Page) {
    await expect.poll(() =>
        page.evaluate(() =>
            Boolean(
                window.pswp
                && window.pswp.opener.isOpen
                && !window.pswp.opener.isOpening,
            )
        ),
    ).toBe(true);
}

async function waitPastMenuCloseTimer(page: Page) {
    await page.evaluate(() =>
        new Promise<void>((resolve) => window.setTimeout(resolve, 350))
    );
}

function photoSwipeLocators(page: Page) {
    return {
        root: page.locator(".pswp"),
        closeButton: page.locator(".pswp__button--close"),
    };
}

test.describe("touch navigation lifecycle", () => {
    test.use(PIXEL_5_TOUCH);

    test.beforeEach(async ({ page }) => {
        await isolateRemotePhotos(page);
    });

    test("catalog keeps first-tap reveal after repeated view transitions", async ({
        page,
    }) => {
        await page.goto("/");

        for (let iteration = 0; iteration < 2; iteration += 1) {
            await openYamaFromHomeWithTouch(page);
            await page.getByRole("link", { name: "RIVERBED" }).click();
            await expect.poll(() => new URL(page.url()).pathname).toBe("/");
        }
    });

    test("mobile menu state survives rapid toggles and repeated scrolling", async ({
        page,
    }) => {
        await page.goto("/");

        for (let iteration = 0; iteration < 2; iteration += 1) {
            await openYamaFromHomeWithTouch(page);
            await page.getByRole("link", { name: "RIVERBED" }).click();
            await expect.poll(() => new URL(page.url()).pathname).toBe("/");
        }

        const toggle = page.locator("[data-site-menu-toggle]");
        const menu = page.locator("[data-site-mobile-menu]");
        const navigation = page.locator("[data-site-navigation]");

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expectHiddenClass(menu, false);

        await toggle.click();
        await toggle.click();
        await waitPastMenuCloseTimer(page);
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expectHiddenClass(menu, false);

        await page.evaluate(() => {
            document.documentElement.style.scrollBehavior = "auto";
            const spacer = document.createElement("div");
            spacer.dataset.testScrollSpacer = "";
            spacer.style.height = "2000px";
            document.body.append(spacer);
        });
        await page.evaluate(() => window.scrollTo(0, 500));
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(500);
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await expect(navigation).toHaveClass(/-translate-y-full/);
        await page.evaluate(() => window.scrollTo(0, 800));
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(800);
        await expect(navigation).toHaveClass(/-translate-y-full/);
        await page.evaluate(() => window.scrollTo(0, 100));
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(100);
        await expect(navigation).not.toHaveClass(/-translate-y-full/);
        await expectHiddenClass(menu, true);

        await toggle.click();
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expectHiddenClass(menu, false);
    });
});

test.describe("album lifecycle", () => {
    test.use(PIXEL_5_TOUCH);

    test.beforeEach(async ({ page }) => {
        await isolateRemotePhotos(page);
    });

    test("tag round trips keep one PhotoSwipe instance", async ({ page }) => {
        await page.goto("/yama/2024-beinandawu");

        for (let iteration = 0; iteration < 2; iteration += 1) {
            await page.locator("#toggle-all-tags").click();
            await page.locator("[data-mountain-tag-link]").first().click();
            await expect(page).toHaveURL(/\/yama\/tags\//);
            await page.goBack();
            await expect(page).toHaveURL(
                /\/yama\/2024-beinandawu\/?$/,
            );
        }

        const photoSwipe = photoSwipeLocators(page);
        await page.locator("[data-photo-lightbox-link]").first().click();
        await waitForPhotoSwipeOpen(page);
        await expect(photoSwipe.root).toHaveCount(1);
        await photoSwipe.closeButton.click();
        await expect(photoSwipe.root).toHaveCount(0);

        await page.locator("#toggle-all-tags").click();
        await page.locator("[data-mountain-tag-link]").first().click();
        await expect(page).toHaveURL(/\/yama\/tags\//);
        await page.goBack();
        await expect(page).toHaveURL(
            /\/yama\/2024-beinandawu\/?$/,
        );
        await page.locator("[data-photo-lightbox-link]").first().click();
        await waitForPhotoSwipeOpen(page);
        await expect(photoSwipe.root).toHaveCount(1);
    });

    test("photo grid flattens the Album and returns to the selected photo", async ({
        page,
    }) => {
        await page.goto("/yama/2024-beinandawu");

        const toggle = page.locator("#toggle-photo-grid");
        const originalPhotos = page.locator(".album-content .photo-container");
        const originalPhotoCount = await originalPhotos.count();
        const selectedPhoto = originalPhotos.nth(7);
        const selectedKey = await selectedPhoto
            .locator(".photo-wrapper")
            .getAttribute("data-item-key");
        expect(selectedKey).toBeTruthy();

        await toggle.click();
        const grid = page.locator("[data-album-photo-grid]");
        await expect(toggle).toHaveAttribute("aria-pressed", "true");
        await expect(grid.locator(".photo-container")).toHaveCount(
            originalPhotoCount,
        );
        await expect(
            grid.locator(".album-photo-grid__row").first()
                .locator(":scope > .photo-container"),
        ).toHaveCount(3);

        const firstCell = grid.locator(".photo-container").first();
        await expect(firstCell.locator(".photo-img")).toHaveCSS(
            "object-fit",
            "contain",
        );
        await expect(firstCell.locator(".photo-img")).toHaveCSS(
            "border-radius",
            "0px",
        );
        await expect(
            grid.locator(".album-photo-grid__row").first(),
        ).toHaveCSS("gap", "2px");
        await expect(grid.locator(".tags-overlay").first()).toBeHidden();

        await grid.locator(".photo-container").nth(7)
            .locator("[data-photo-lightbox-link]")
            .click();

        await expect(grid).toHaveCount(0);
        await expect(toggle).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator(".pswp")).toHaveCount(0);
        await expect.poll(async () => {
            const position = await page
                .locator(`.photo-wrapper[data-item-key="${selectedKey}"]`)
                .boundingBox();
            return Boolean(
                position &&
                position.y < PIXEL_5_TOUCH.viewport.height &&
                position.y + position.height > 0,
            );
        }).toBe(true);
    });
});

test.describe("desktop Album photo grid", () => {
    test.use({ viewport: { width: 1280, height: 900 } });

    test.beforeEach(async ({ page }) => {
        await isolateRemotePhotos(page);
    });

    test("groups five original-ratio photos into aligned rows", async ({
        page,
    }) => {
        await page.goto("/yama/2024-beinandawu");
        await page.locator("#toggle-photo-grid").click();

        const firstRowPhotos = page
            .locator(".album-photo-grid__row")
            .first()
            .locator(":scope > .photo-container");
        await expect(firstRowPhotos).toHaveCount(5);
        await expect(
            page.locator(".album-photo-grid__row").first(),
        ).toHaveCSS("gap", "4.8px");
        await expect.poll(async () => {
            const heights = await firstRowPhotos.evaluateAll((photos) =>
                photos.map((photo) => photo.getBoundingClientRect().height)
            );
            return Math.max(...heights) - Math.min(...heights);
        }).toBeLessThan(1);
    });
});

test.describe("keyboard lifecycle", () => {
    test.beforeEach(async ({ page }) => {
        await isolateRemotePhotos(page);
    });

    test("ArrowDown has one response after repeated navigation", async ({
        page,
    }) => {
        await page.goto("/");

        for (let iteration = 0; iteration < 2; iteration += 1) {
            await page.locator('a[href="/yama"]').first().click();
            await expect(page).toHaveURL(/\/yama\/?$/);
            await page.getByRole("link", { name: "RIVERBED" }).click();
            await expect.poll(() => new URL(page.url()).pathname).toBe("/");
        }

        await page.evaluate(() => {
            window.__riverbedScrollCalls = 0;
            window.scrollTo = () => {
                window.__riverbedScrollCalls += 1;
            };
        });
        await page.keyboard.press("ArrowDown");
        await expect.poll(() =>
            page.evaluate(() => window.__riverbedScrollCalls),
        ).toBe(1);
    });

    for (const editable of [
        {
            name: "empty contenteditable",
            html: '<div id="editable" contenteditable></div>',
            focus: "#editable",
        },
        {
            name: "plaintext-only contenteditable",
            html: '<div id="editable" contenteditable="plaintext-only"></div>',
            focus: "#editable",
        },
        {
            name: "inherited editable descendant",
            html: '<div contenteditable><span id="editable" tabindex="0">edit</span></div>',
            focus: "#editable",
        },
    ]) {
        test(`ArrowDown ignores ${editable.name}`, async ({ page }) => {
            await page.goto("/");
            await page.evaluate((html) => {
                const host = document.createElement("div");
                host.innerHTML = html;
                document.body.append(host);

                window.__riverbedScrollCalls = 0;
                window.scrollTo = () => {
                    window.__riverbedScrollCalls += 1;
                };
            }, editable.html);
            await page.locator(editable.focus).focus();

            await page.keyboard.press("ArrowDown");
            await expect.poll(() =>
                page.evaluate(() => window.__riverbedScrollCalls),
            ).toBe(0);
        });
    }
});
