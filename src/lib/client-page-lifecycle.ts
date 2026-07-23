export type PageCleanup = () => void;
export type PageMount = () => void | PageCleanup;

export function installPageLifecycle(
    events: EventTarget,
    mount: PageMount,
): PageCleanup {
    let activeCleanup: PageCleanup | undefined;

    const cleanup = () => {
        const cleanupCurrentMount = activeCleanup;
        activeCleanup = undefined;
        cleanupCurrentMount?.();
    };

    const handlePageLoad = () => {
        cleanup();
        activeCleanup = mount() || undefined;
    };

    events.addEventListener("astro:page-load", handlePageLoad);
    events.addEventListener("astro:before-swap", cleanup);

    return () => {
        events.removeEventListener("astro:page-load", handlePageLoad);
        events.removeEventListener("astro:before-swap", cleanup);
        cleanup();
    };
}
