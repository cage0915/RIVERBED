import { expect, test, type Page } from '@playwright/test';

async function loadAlbum(page: Page) {
    await page.route('https://photos.cage0915.com/**', route => route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="1000"><rect width="1500" height="1000" fill="#4682b4"/></svg>',
    }));
    await page.goto('/yama/2025-omoteginza-d3/');
    await page.evaluate(() => document.fonts.ready);
}

async function expectViewportWidth(page: Page, width: number) {
    await expect.poll(() => page.evaluate(() => ({
        layout: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
    }))).toEqual({ layout: width, scroll: width });
    // Desktop WebKit can subtract its native scrollbar from visualViewport;
    // neither engine should expand the visual viewport and shrink the page.
    await expect.poll(() => page.evaluate(() => window.visualViewport!.width)).toBeLessThanOrEqual(width + 0.5);
    await expect.poll(() => page.evaluate(() => window.visualViewport!.scale)).toBeGreaterThanOrEqual(0.999);
}

for (const width of [393, 430]) {
    test.describe(`full-bleed album at ${width}px`, () => {
        test.use({ viewport: { width, height: 852 }, isMobile: true, hasTouch: true });

        test('edge tags do not shrink the page or lightbox; carousel still scrolls', async ({ page }) => {
            await loadAlbum(page);

            // This real album has right-edge labels extending past the photo.
            await expect(page.locator('.tag-name').filter({ hasText: '爺ヶ岳' }).first()).toHaveCount(1);
            await expectViewportWidth(page, width);
            const photo = page.locator('.photo-row .photo-img').first();
            await expect.poll(async () => (await photo.boundingBox())?.width).toBe(width);

            await page.locator('#toggle-all-tags').click();
            await expectViewportWidth(page, width);
            await page.locator('.photo-row [data-photo-lightbox-link]').first().click();
            await expect(page.locator('.pswp')).toBeVisible();
            await expect.poll(() => page.evaluate(() => Boolean(
                window.pswp?.opener.isOpen && !window.pswp.opener.isOpening,
            ))).toBe(true);
            await expectViewportWidth(page, width);
            const visibleWidth = await page.evaluate(() => Math.round(window.visualViewport!.width));
            await expect.poll(async () => Math.round((await page.locator('.pswp').boundingBox())!.width)).toBe(visibleWidth);
            await expect.poll(async () => (await page.locator('.pswp__img').last().boundingBox())?.width).toBe(width);
            await page.locator('.pswp__button--close').click();
            await expect(page.locator('.pswp')).toHaveCount(0);
            await page.locator('#toggle-all-tags').click();

            const carousel = page.locator('.carousel-section').first();
            await carousel.scrollIntoViewIfNeeded();
            await carousel.locator('.carousel-track').evaluate(track => {
                track.scrollTo({ left: track.scrollWidth, behavior: 'instant' });
            });
            await expect.poll(() => carousel.locator('.carousel-track').evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
            await expect.poll(() => carousel.locator('.carousel-track').evaluate(track => {
                const slide = track.lastElementChild!.getBoundingClientRect();
                return Math.abs(slide.left - track.getBoundingClientRect().left);
            })).toBeLessThan(1);
            await expectViewportWidth(page, width);
        });

        test('info enables bounded Row panning and gapless Carousel edge space', async ({ page }) => {
            await loadAlbum(page);
            // Use real label markup at both edges to exercise negative rotated
            // bounds, including the first and last Carousel slide.
            await page.evaluate(() => {
                const template = document.querySelector('.tags-overlay')!;
                const marker = document.querySelector('.tag-marker')!;
                for (const selector of ['.photo-row', '.carousel-track']) {
                    const track = document.querySelector(selector)!;
                    const photos = track.querySelectorAll('.photo-wrapper');
                    [photos[0], photos[photos.length - 1]].forEach((photo, index) => {
                        let overlay = photo.querySelector('.tags-overlay');
                        if (!overlay) {
                            overlay = template.cloneNode(false) as HTMLElement;
                            photo.append(overlay);
                        }
                        photo.setAttribute('data-has-tags', 'true');
                        const label = marker.cloneNode(true) as HTMLElement;
                        label.style.left = index === 0 ? '0%' : '100%';
                        label.style.top = '50%';
                        label.dataset.testEdge = index === 0 ? 'left' : 'right';
                        overlay.append(label);
                    });
                }
            });
            const row = page.locator('.photo-row').first();
            const track = page.locator('.carousel-track').first();
            const beforeWidth = await row.locator('.photo-img').first().evaluate(el => el.getBoundingClientRect().width);
            await expect(row).not.toHaveAttribute('data-mobile-row-pan');
            await expect(track).toHaveCSS('column-gap', '0px');
            await page.locator('#toggle-all-tags').click();
            await expect(row).toHaveAttribute('data-mobile-row-pan', '');
            await expect.poll(() => row.locator('.photo-img').first().evaluate(el => el.getBoundingClientRect().width)).toBe(beforeWidth);

            for (const scroller of [row, track]) {
                await expect.poll(() => scroller.evaluate(el => parseFloat(el.style.getPropertyValue('--mobile-tag-right')))).toBeGreaterThan(0);
                const range = await scroller.evaluate(el => ({
                    actual: el.scrollWidth - el.clientWidth,
                    expected: [...el.children].reduce((sum, slide) => sum + (slide as HTMLElement).offsetWidth, 0)
                        - el.clientWidth + parseFloat(el.style.getPropertyValue('--mobile-tag-left'))
                        + parseFloat(el.style.getPropertyValue('--mobile-tag-right')),
                }));
                expect(Math.abs(range.actual - range.expected)).toBeLessThanOrEqual(1);
                await scroller.evaluate(el => el.scrollTo({ left: 100000, behavior: 'instant' }));
                await expect.poll(() => scroller.evaluate(el => {
                    const tag = el.querySelector('[data-test-edge="right"] .tag-name')!.getBoundingClientRect();
                    return tag.right - el.getBoundingClientRect().right;
                })).toBeLessThanOrEqual(0);
                await scroller.evaluate(el => el.scrollTo({ left: -100000, behavior: 'instant' }));
                await expect.poll(() => scroller.evaluate(el => {
                    const tag = el.querySelector('[data-test-edge="left"] .tag-name')!.getBoundingClientRect();
                    return el.getBoundingClientRect().left - tag.left;
                })).toBeLessThanOrEqual(0);
            }
            await expect.poll(() => track.evaluate(el => {
                const slides = [...el.children];
                return slides[1].getBoundingClientRect().left - slides[0].getBoundingClientRect().right;
            })).toBe(0);
            await expectViewportWidth(page, width);
            await page.setViewportSize({ width: width + 20, height: 852 });
            await expect.poll(() => row.locator('.photo-img').first().evaluate(el => el.getBoundingClientRect().width)).toBe(width + 20);
            await expectViewportWidth(page, width + 20);
            await page.locator('#toggle-all-tags').click();
            await expect(row).not.toHaveAttribute('data-mobile-row-pan');
            await expect.poll(() => row.evaluate(el => el.scrollLeft)).toBe(0);
            await expect.poll(() => track.evaluate(el => el.scrollWidth - el.clientWidth * el.children.length)).toBe(0);
            await expectViewportWidth(page, width + 20);

            await page.setViewportSize({ width: 1024, height: 852 });
            await expect(track).toHaveCSS('column-gap', '8px');
            await expect(row).not.toHaveAttribute('data-mobile-row-pan');
            await expect.poll(() => track.evaluate(el => {
                const slide = el.firstElementChild as HTMLElement;
                return Math.round(slide.offsetWidth / el.clientWidth * 100);
            })).toBe(80);
        });
    });
}
