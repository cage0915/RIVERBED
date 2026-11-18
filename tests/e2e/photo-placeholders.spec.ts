import { expect, test } from "@playwright/test";

const ONE_PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl9ZJkAAAAASUVORK5CYII=",
    "base64",
);

test.use({ viewport: { width: 1440, height: 900 } });

test("a photo still loading shows its ThumbHash preview, not an empty box", async ({ page }) => {
    // Hold every photo request so the covers never arrive.
    await page.route("https://photos.cage0915.com/**", () => {});
    await page.goto("/y");

    const cover = page.locator("[data-catalog-card] img.photo-img[data-thumbhash]").first();
    await expect(cover).toBeVisible();
    await expect
        .poll(() => cover.evaluate((image) => image.style.backgroundImage))
        .toMatch(/^url\("?data:image\/png;base64,/);
    expect(await cover.evaluate((image) => getComputedStyle(image).opacity)).toBe("1");
});

test("covers already loaded stay visible when the client router swaps pages", async ({ page }) => {
    await page.route("https://photos.cage0915.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "image/png", body: ONE_PIXEL_PNG });
    });
    await page.goto("/");
    await page.click('a.album-link[href="/y"]');
    await expect(page).toHaveURL(/\/y$/);

    // Sample every frame of the trip back home: no cover may dip below full opacity.
    await page.evaluate(() => {
        const state = window as unknown as { minCoverOpacity: number };
        state.minCoverOpacity = 1;
        const sample = () => {
            document.querySelectorAll<HTMLImageElement>(".album-cover img.photo-img.active, .album-cover img.photo-img:not(.slide)")
                .forEach((image) => {
                    state.minCoverOpacity = Math.min(state.minCoverOpacity, Number(getComputedStyle(image).opacity));
                });
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    await page.click('a.album-link[href="/"], nav a[href="/"]');
    await expect(page).toHaveURL(/\/$/);
    await page.waitForTimeout(1000);

    expect(
        await page.evaluate(() => (window as unknown as { minCoverOpacity: number }).minCoverOpacity),
    ).toBe(1);
});
