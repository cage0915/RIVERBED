export type CoverState = {
    albumSlug: string;
    coverKey: string;
    zoom: number;
    x: number;
    y: number;
};

export type PersistedCover = { state: CoverState; imageSrc: string };

export type CoverSaveResponse = {
    coverKey: string;
    coverZoom: number;
    coverOffset: { x: number; y: number };
};

export function settleCoverSave(
    persisted: PersistedCover,
    response: CoverSaveResponse | null,
    imageSrc = persisted.imageSrc,
): PersistedCover {
    if (!response) return {
        state: { ...persisted.state },
        imageSrc: persisted.imageSrc,
    };
    return {
        state: {
            ...persisted.state,
            coverKey: response.coverKey,
            zoom: response.coverZoom,
            x: response.coverOffset.x,
            y: response.coverOffset.y,
        },
        imageSrc,
    };
}

export function createCoverSaveQueue() {
    const queues = new WeakMap<object, Promise<void>>();
    return function enqueue<T>(card: object, operation: () => T | Promise<T>): Promise<T> {
        const previous = queues.get(card) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(operation);
        const tail = result.then(() => undefined, () => undefined);
        queues.set(card, tail);
        return result.finally(() => {
            if (queues.get(card) === tail) queues.delete(card);
        });
    };
}

export function isCoverDraftCurrent(
    currentState: CoverState,
    currentImageSrc: string,
    draftState: CoverState,
    draftImageSrc: string,
) {
    return currentImageSrc === draftImageSrc &&
        currentState.albumSlug === draftState.albumSlug &&
        currentState.coverKey === draftState.coverKey &&
        currentState.zoom === draftState.zoom &&
        currentState.x === draftState.x &&
        currentState.y === draftState.y;
}
