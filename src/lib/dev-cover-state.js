export function settleCoverSave(persisted, response, imageSrc = persisted.imageSrc) {
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
    const queues = new WeakMap();
    return function enqueue(card, operation) {
        const previous = queues.get(card) ?? Promise.resolve();
        const result = previous.catch(() => undefined).then(operation);
        const tail = result.then(() => undefined, () => undefined);
        queues.set(card, tail);
        return result.finally(() => {
            if (queues.get(card) === tail) queues.delete(card);
        });
    };
}

export function isCoverDraftCurrent(currentState, currentImageSrc, draftState, draftImageSrc) {
    return currentImageSrc === draftImageSrc &&
        currentState.albumSlug === draftState.albumSlug &&
        currentState.coverKey === draftState.coverKey &&
        currentState.zoom === draftState.zoom &&
        currentState.x === draftState.x &&
        currentState.y === draftState.y;
}
