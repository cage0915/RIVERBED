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

test("album breadcrumbs follow the section on screen in both directions", async ({ page }) => {
    await page.goto("/yama/2025-da-xiao-bajianshan");

    const links = page.locator("[data-album-breadcrumb]");
    await expect(links).toHaveCount(3);
    const activeLabel = () =>
        page.locator('[data-album-breadcrumb][data-active="true"]').textContent();
    const scrollToTitle = (index: number) =>
        page.evaluate((titleIndex) => {
            const title = document.querySelectorAll<HTMLElement>(
                ".album-content .text-block--title",
            )[titleIndex];
            window.scrollTo({ top: title.getBoundingClientRect().top + window.scrollY - 150, behavior: "instant" });
        }, index);

    await expect.poll(activeLabel).toContain("D1");
    await expect(links.first()).toHaveCSS("color", "rgba(255, 255, 255, 0.9)");

    await scrollToTitle(1);
    await expect.poll(activeLabel).toContain("D2");

    // Scrolling back up above D2's title returns to D1 even though D1's title is off screen.
    await page.evaluate(() => window.scrollBy({ top: -400, behavior: "instant" }));
    await expect.poll(activeLabel).toContain("D1");

    await page.evaluate(() =>
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" })
    );
    await expect.poll(activeLabel).toContain("D3");
});
