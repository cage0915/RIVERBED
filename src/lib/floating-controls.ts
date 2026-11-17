/**
 * On phones, tuck the floating page controls away while the reader scrolls
 * down and bring them back on any scroll up — the same rhythm as the navbar,
 * so the photos stay clear until the reader looks for a way around.
 */
export function installFloatingControlsAutoHide(
    controls: HTMLElement,
    signal: AbortSignal,
    { mobileQuery = "(max-width: 767px)", threshold = 120 } = {},
) {
    const mobile = window.matchMedia(mobileQuery);
    let lastScrollY = window.scrollY;

    const setHidden = (hidden: boolean) => {
        controls.dataset.scrollHidden = String(hidden);
        // Inert keeps hidden buttons out of taps and focus; the children's own
        // pointer-events classes would otherwise override the container's.
        controls.inert = hidden;
    };

    setHidden(false);

    window.addEventListener("scroll", () => {
        const currentScrollY = window.scrollY;
        setHidden(
            mobile.matches
                && currentScrollY > lastScrollY
                && currentScrollY > threshold,
        );
        lastScrollY = currentScrollY;
    }, { passive: true, signal });

    mobile.addEventListener("change", () => {
        if (!mobile.matches) setHidden(false);
    }, { signal });

    signal.addEventListener("abort", () => setHidden(false), { once: true });
}
