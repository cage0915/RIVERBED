import { expect, test } from "@playwright/test";

const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9ZJkAAAAASUVORK5CYII=",
    "base64",
);

test.use({ viewport: { width: 1440, height: 900 } });

test.beforeEach(async ({ page }) => {
    await page.route("https://photos.cage0915.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "image/png", body: ONE_PIXEL_PNG });
    });
});

test("the first Panorama on screen hints its view toggle once per visitor", async ({ page }) => {
    await page.goto("/yama/2026-hakuba");

    const section = page.locator("[data-photo-panorama]").first();
    const toggle = section.locator(".photo-panorama-view-toggle");
    await expect(section).not.toHaveAttribute("data-view-hint");

    await toggle.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await expect(section).toHaveAttribute("data-view-hint", "true");
    expect(
        await page.evaluate(() => localStorage.getItem("riverbed:panorama-view-hint-seen")),
    ).toBe("true");

    // The hint settles back by itself.
    await expect(section).not.toHaveAttribute("data-view-hint", { timeout: 5000 });

    await page.reload();
    await toggle.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    await page.waitForTimeout(500);
    await expect(section).not.toHaveAttribute("data-view-hint");
});

test("the album grid shows a sliced Panorama photo once and returns to it on click", async ({ page }) => {
    await page.goto("/yama/2026-tateyama-tsurugi");

    const section = page.locator('[data-photo-panorama][data-panorama-slices="3"]').first();
    await expect(section.locator(".photo-panorama-slice")).toHaveCount(3);
    const sourceHref = await section
        .locator(".photo-panorama-single-source [data-photo-lightbox-link]")
        .getAttribute("href");

    await page.locator("#toggle-photo-grid").click();

    const grid = page.locator("[data-album-photo-grid]");
    await expect(grid.locator(".photo-panorama-slice")).toHaveCount(0);
    const tile = grid.locator(`.photo-container:has(a[href="${sourceHref}"])`);
    await expect(tile).toHaveCount(1);

    await tile.locator("[data-photo-lightbox-link]").click();
    await expect(grid).toHaveCount(0);
    await expect(section.locator(".photo-panorama-stage")).toBeInViewport();
    await expect(section.locator(".photo-panorama-single-source")).toHaveCount(1);
    await expect(section.locator(".photo-panorama-slice")).toHaveCount(3);
});

test("the view toggle shows one dot per slide with the current one as a capsule", async ({ page }) => {
    await page.goto("/yama/2026-tateyama-tsurugi");

    const section = page.locator('[data-photo-panorama][data-panorama-slices="3"][data-view="carousel"]').first();
    const dots = section.locator(".photo-panorama-view-dot");
    await expect(dots).toHaveCount(3);

    // Layout width: the hidden symbol is scaled down, which bounding boxes would include.
    const iconWidths = await section.evaluate((element) =>
        [".photo-panorama-view-icon--carousel", ".photo-panorama-view-icon--panorama"].map(
            (selector) => element.querySelector<HTMLElement>(selector)!.offsetWidth,
        )
    );
    // Three slides, drawn as PhotoCarousel's dots: two 6px dots, one 18px
    // capsule and two 0.35rem (5.6px) gaps; the panorama capsule matches.
    expect(iconWidths).toEqual([41, 41]);

    await expect(dots.nth(0)).toHaveClass(/active/);
    await section.locator(".photo-panorama-arrow--next").evaluate((button: HTMLButtonElement) => button.click());
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.nth(0)).not.toHaveClass(/active/);
    await expect.poll(() => dots.nth(1).evaluate((dot: HTMLElement) => dot.offsetWidth)).toBe(18);
});

test("switching views keeps the toggle where it was on screen", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("riverbed:panorama-view-hint-seen", "true"));
    await page.goto("/yama/2026-tateyama-tsurugi");

    const index = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-photo-panorama]")].findIndex(
            (section) => section.dataset.panoramaSlices === "3" && section.dataset.view === "carousel",
        )
    );
    const section = page.locator("[data-photo-panorama]").nth(index);
    const toggle = section.locator(".photo-panorama-view-toggle");
    await toggle.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    // Loading the stand-in photos re-sizes the stage from their ratio; let that settle
    // before measuring, so only the view switch can move the toggle.
    await expect.poll(() =>
        section.evaluate((element) =>
            // The hidden source of a sliced photo is lazy and never loads; skip it.
            [...element.querySelectorAll("img")]
                .filter((image) => image.getClientRects().length > 0)
                .every((image) => image.complete && image.naturalWidth > 0)
        ),
    ).toBe(true);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await toggle.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
    const toggleTop = () => toggle.evaluate((element) => element.getBoundingClientRect().top);
    const startTop = await toggleTop();

    for (const view of ["panorama", "carousel"]) {
        const stageHeight = await section.locator(".photo-panorama-stage").evaluate((stage: HTMLElement) => stage.offsetHeight);
        await toggle.click();
        await expect(section).toHaveAttribute("data-view", view);
        await expect(section).not.toHaveAttribute("data-view-transitioning");
        // The stage really changed height, and the page scrolled to absorb it.
        expect(
            await section.locator(".photo-panorama-stage").evaluate((stage: HTMLElement) => stage.offsetHeight),
        ).not.toBe(stageHeight);
        expect(Math.abs((await toggleTop()) - startTop)).toBeLessThan(1);
    }
});

test("the view toggle is an arrow at the row's right edge that flips with the view", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("riverbed:panorama-view-hint-seen", "true"));
    await page.goto("/yama/2026-tateyama-tsurugi");

    // Pin the block by position: a data-view filter would re-match after switching.
    const index = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>("[data-photo-panorama]")].findIndex(
            (section) => section.dataset.panoramaSlices === "3" && section.dataset.view === "carousel",
        )
    );
    const section = page.locator("[data-photo-panorama]").nth(index);
    const toggle = section.locator(".photo-panorama-view-toggle");
    await toggle.scrollIntoViewIfNeeded();

    const edges = await section.evaluate((element) => {
        const row = element.querySelector(".photo-panorama-controls")!.getBoundingClientRect();
        const button = element.querySelector(".photo-panorama-view-toggle")!.getBoundingClientRect();
        const dots = element.querySelector(".photo-panorama-view-indicator")!.getBoundingClientRect();
        return {
            rightGap: Math.round(row.right - button.right),
            dotsOffCentre: Math.round(dots.left + dots.width / 2 - (row.left + row.width / 2)),
        };
    });
    expect(edges).toEqual({ rightGap: 0, dotsOffCentre: 0 });

    const arrowOpacity = (name: string) =>
        section.locator(`.photo-panorama-view-arrow--${name}`).evaluate((arrow) => getComputedStyle(arrow).opacity);
    await expect.poll(() => arrowOpacity("expand")).toBe("1");
    await expect.poll(() => arrowOpacity("collapse")).toBe("0");

    await toggle.click();
    await expect(section).toHaveAttribute("data-view", "panorama");
    await expect.poll(() => arrowOpacity("expand")).toBe("0");
    await expect.poll(() => arrowOpacity("collapse")).toBe("1");
});

for (const width of [390, 700]) {
    test.describe(`full-bleed Panorama at ${width}px`, () => {
        test.use({ viewport: { width, height: 844 } });

        test("the view toggle lines up under the floating buttons", async ({ page }) => {
            await page.addInitScript(() => localStorage.setItem("riverbed:panorama-view-hint-seen", "true"));
            await page.goto("/yama/2026-tateyama-tsurugi");

            const toggle = page.locator("[data-photo-panorama] .photo-panorama-view-toggle").first();
            await toggle.evaluate((element) => element.scrollIntoView({ block: "center", behavior: "instant" }));
            const centre = (selector: string) =>
                page.locator(selector).first().evaluate((element) => {
                    const box = element.getBoundingClientRect();
                    return box.left + box.width / 2;
                });
            expect(await centre("[data-photo-panorama] .photo-panorama-view-toggle"))
                .toBeCloseTo(await centre("#toggle-photo-grid > div"), 0);
        });
    });
}
