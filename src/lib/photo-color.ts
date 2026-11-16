/**
 * Inline style declaring a photo's average colour (#rrggbb) for its
 * `.photo-frame` to paint while the photo loads (see global.css). Empty when
 * the colour is unknown, so the frame falls back to its neutral grey.
 */
export function photoColorStyle(color: string | undefined): string {
    return color ? `--photo-color: ${color};` : "";
}
