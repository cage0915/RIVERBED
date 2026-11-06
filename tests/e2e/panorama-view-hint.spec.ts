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
