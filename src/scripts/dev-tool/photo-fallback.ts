// Dev photos point at local ./r2 files; fall back to the R2 copy when one is missing.
import { installPageLifecycle } from "../../lib/client-page-lifecycle";

installPageLifecycle(document, () => {
    const controller = new AbortController();
    const initializedImages: HTMLImageElement[] = [];

    document
        .querySelectorAll<HTMLImageElement>("img[data-dev-fallback-url]")
        .forEach((image) => {
            if (image.dataset.devFallbackReady === "true") return;
            image.dataset.devFallbackReady = "true";
            initializedImages.push(image);

            const useFallback = () => {
                const fallbackUrl = image.dataset.devFallbackUrl;
                if (!fallbackUrl) return;

                delete image.dataset.devFallbackUrl;
                image.src = fallbackUrl;

                const link = image.closest<HTMLAnchorElement>("a.pswp-link");
                if (link) {
                    link.href = fallbackUrl;
                    link.dataset.pswpSrc = fallbackUrl;
                }
            };

            image.addEventListener("error", useFallback, {
                once: true,
                signal: controller.signal,
            });
            if (image.complete && image.naturalWidth === 0) useFallback();
        });

    return () => {
        controller.abort();
        initializedImages.forEach((image) => {
            if (image.dataset.devFallbackUrl) {
                delete image.dataset.devFallbackReady;
            }
        });
    };
});
