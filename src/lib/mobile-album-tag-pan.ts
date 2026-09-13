/** Keep tag overflow inside each media scroller instead of widening the page. */
export function installMobileAlbumTagPan(article: HTMLElement) {
    const mobile = window.matchMedia('(max-width: 767px)');
    const controller = new AbortController();
    const managed = new Set<HTMLElement>();
    let frame = 0;
    let disposed = false;

    const setEdges = (track: HTMLElement, left: number, right: number) => {
        const oldLeft = parseFloat(track.style.getPropertyValue('--mobile-tag-left')) || 0;
        const oldRight = parseFloat(track.style.getPropertyValue('--mobile-tag-right')) || 0;
        if (oldLeft === left && oldRight === right) return;
        const position = track.scrollLeft;
        track.style.setProperty('--mobile-tag-left', `${left}px`);
        track.style.setProperty('--mobile-tag-right', `${right}px`);
        track.scrollTo({ left: Math.max(0, position + left - oldLeft), behavior: 'instant' });
    };

    const restoreRow = (track: HTMLElement) => {
        track.removeAttribute('data-mobile-row-pan');
        for (const slide of Array.from(track.children)) {
            (slide as HTMLElement).style.removeProperty('--mobile-photo-width');
        }
    };

    const update = () => {
        frame = 0;
        const enabled = mobile.matches && article.dataset.gridActive !== 'true';
        const tracks = article.querySelectorAll<HTMLElement>('.photo-row, .carousel-track');
        for (const track of tracks) {
            managed.add(track);
            const carousel = track.classList.contains('carousel-track')
                ? !track.parentElement?.classList.contains('dev-preview-as-row')
                : track.parentElement?.classList.contains('dev-preview-as-carousel');
            const slides = Array.from(track.children) as HTMLElement[];
            const tags = enabled ? Array.from(track.querySelectorAll<HTMLElement>(
                '.photo-wrapper.show-info .tag-content, .photo-wrapper.show-info .tag-link, '
                + '.photo-wrapper.show-info .tag-name, .photo-wrapper.show-info .dev-tag-edit-btn',
            )) : [];

            if (!tags.length || !slides.length) {
                setEdges(track, 0, 0);
                restoreRow(track);
                continue;
            }

            if (!carousel) {
                // Preserve the existing Row proportions; spacer items must not
                // consume the flexible space and shrink the photographs.
                const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
                const available = track.clientWidth - gap * (slides.length - 1);
                const weights = slides.map(slide => {
                    const image = slide.querySelector('img');
                    return image?.naturalWidth && image.naturalHeight
                        ? image.naturalWidth / image.naturalHeight : 1;
                });
                const total = weights.reduce((sum, weight) => sum + weight, 0);
                slides.forEach((slide, index) => slide.style.setProperty(
                    '--mobile-photo-width', `${available * weights[index] / total}px`,
                ));
                track.setAttribute('data-mobile-row-pan', '');
            } else {
                restoreRow(track);
            }

            const first = slides[0].getBoundingClientRect();
            const last = slides[slides.length - 1].getBoundingClientRect();
            const bounds = tags.map(tag => tag.getBoundingClientRect());
            const overflowLeft = first.left - Math.min(...bounds.map(rect => rect.left));
            const overflowRight = Math.max(...bounds.map(rect => rect.right)) - last.right;
            // Include a small breathing space, but only on an overflowing edge.
            const left = overflowLeft > 0.5 ? Math.ceil(overflowLeft) + 8 : 0;
            const right = overflowRight > 0.5 ? Math.ceil(overflowRight) + 8 : 0;
            setEdges(track, left, right);
            if (!carousel && !left && !right) restoreRow(track);
        }
    };

    const schedule = () => {
        if (!disposed && !frame) frame = requestAnimationFrame(update);
    };
    // Covers the info toggle, grid mode, and dynamically edited media blocks.
    const mutations = new MutationObserver(schedule);
    mutations.observe(article, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['class', 'data-grid-active', 'data-has-tags'],
    });
    const resize = new ResizeObserver(schedule);
    resize.observe(article);
    mobile.addEventListener('change', schedule, { signal: controller.signal });
    article.addEventListener('load', schedule, { capture: true, signal: controller.signal });
    document.fonts.ready.then(schedule);
    schedule();

    return () => {
        disposed = true;
        controller.abort();
        mutations.disconnect();
        resize.disconnect();
        cancelAnimationFrame(frame);
        for (const track of managed) {
            restoreRow(track);
            track.style.removeProperty('--mobile-tag-left');
            track.style.removeProperty('--mobile-tag-right');
        }
    };
}
