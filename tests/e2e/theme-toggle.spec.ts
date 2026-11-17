import { expect, test, type Page } from "@playwright/test";

const theme = (page: Page) => page.evaluate(() => document.documentElement.dataset.theme);
const pageBackground = (page: Page) =>
    page.evaluate(() => getComputedStyle(document.body).backgroundColor);

test.describe("theme toggle", () => {
    test("follows the system setting until the visitor chooses", async ({ page }) => {
        await page.emulateMedia({ colorScheme: "light" });
        await page.goto("/");
        expect(await theme(page)).toBe("light");
        expect(await pageBackground(page)).toBe("rgb(228, 228, 231)");

        await page.emulateMedia({ colorScheme: "dark" });
        await expect.poll(() => theme(page)).toBe("dark");
        expect(await pageBackground(page)).toBe("rgb(18, 18, 18)");
    });

    test("keeps the chosen theme across client navigation and reloads", async ({ page }) => {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto("/");

        await page.locator("[data-site-navigation] .sm\\:flex [data-theme-toggle]").click();
        expect(await theme(page)).toBe("light");
        await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#e4e4e7");

        // A later system change no longer overrides the visitor's choice.
        await page.emulateMedia({ colorScheme: "light" });
        await page.emulateMedia({ colorScheme: "dark" });
        expect(await theme(page)).toBe("light");

        await page.locator('[data-site-navigation] a[href="/yama"]').first().click();
        await page.waitForURL("**/yama");
        expect(await theme(page)).toBe("light");
        expect(await pageBackground(page)).toBe("rgb(228, 228, 231)");

        await page.reload();
        expect(await theme(page)).toBe("light");

        await page.locator("[data-site-navigation] .sm\\:flex [data-theme-toggle]").click();
        expect(await theme(page)).toBe("dark");
    });

    test("sits left of RSS in the phone menu", async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/");
        await page.locator("[data-site-menu-toggle]").click();

        const menu = page.locator("[data-site-mobile-menu]");
        const toggle = menu.locator("[data-theme-toggle]");
        const rss = menu.locator('a[href="/rss.xml"]');
        await expect(toggle).toBeVisible();
        const toggleBox = await toggle.boundingBox();
        const rssBox = await rss.boundingBox();
        expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(rssBox!.x);
    });
});
