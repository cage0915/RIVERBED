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
    // Three slides: two 4px dots, one 10px capsule and two 3px gaps.
    expect(iconWidths).toEqual([24, 24]);

    await expect(dots.nth(0)).toHaveClass(/active/);
    await section.locator(".photo-panorama-arrow--next").evaluate((button: HTMLButtonElement) => button.click());
    await expect(dots.nth(1)).toHaveClass(/active/);
    await expect(dots.nth(0)).not.toHaveClass(/active/);
    await expect.poll(() => dots.nth(1).evaluate((dot: HTMLElement) => dot.offsetWidth)).toBe(10);
});
