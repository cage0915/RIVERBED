import { expect, test, type Page } from "@playwright/test";

async function loadAlbum(page: Page) {
    await page.route("https://photos.cage0915.com/**", route => route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000"><rect width="1500" height="1000" fill="#4682b4"/></svg>',
    }));
    await page.goto("/yama/2025-da-xiao-bajianshan");
}

const scrollTo = (page: Page, top: number) =>
    page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), top);

test.describe("floating controls on a phone", () => {
    test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

    test("hide while scrolling down, return on scroll up, and drop scroll-to-bottom", async ({ page }) => {
        await loadAlbum(page);
        const controls = page.locator("[data-floating-controls]");

        await expect(page.locator("#scroll-to-bottom")).toBeHidden();
        await expect(controls).toHaveAttribute("data-scroll-hidden", "false");

        await scrollTo(page, 600);
        await expect(controls).toHaveAttribute("data-scroll-hidden", "true");
        await expect.poll(() => controls.evaluate((el) => (el as HTMLElement).inert)).toBe(true);
        await expect(controls).toHaveCSS("opacity", "0");

        await scrollTo(page, 500);
        await expect(controls).toHaveAttribute("data-scroll-hidden", "false");
        await expect.poll(() => controls.evaluate((el) => (el as HTMLElement).inert)).toBe(false);
        await expect(controls).toHaveCSS("opacity", "1");
    });
});

test.describe("floating controls on desktop", () => {
    test.use({ viewport: { width: 1440, height: 900 } });

    test("stay put while scrolling down and keep scroll-to-bottom", async ({ page }) => {
        await loadAlbum(page);
        const controls = page.locator("[data-floating-controls]");

        await scrollTo(page, 600);
        await expect(page.locator("#scroll-to-bottom")).toBeVisible();
        await expect(controls).toHaveAttribute("data-scroll-hidden", "false");
    });
});
