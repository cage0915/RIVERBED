export type RichTextToken =
    | { type: "text"; value: string }
    | { type: "break" }
    | { type: "link"; label: string; href: string; external: boolean }
    | { type: "strong"; value: string }
    | { type: "emphasis"; value: string };

const parseLinkTarget = (
    input: string,
): { href: string; external: boolean } | null => {
    const href = input.trim();
    if ((href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#")) {
        return { href, external: false };
    }

    try {
        const url = new URL(href);
        if (url.protocol === "http:" || url.protocol === "https:") {
            return { href: url.href, external: true };
        }
    } catch {
        // Invalid and unsupported targets remain visible as plain text.
    }

    return null;
};

const appendInlineText = (tokens: RichTextToken[], value: string) => {
    const emphasisPattern = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*)/g;
    let cursor = 0;

    for (const match of value.matchAll(emphasisPattern)) {
        const index = match.index ?? 0;
        if (index > cursor) tokens.push({ type: "text", value: value.slice(cursor, index) });

        if (match[2]) tokens.push({ type: "strong", value: match[2] });
        else tokens.push({ type: "emphasis", value: match[3] });

        cursor = index + match[0].length;
    }

    if (cursor < value.length) tokens.push({ type: "text", value: value.slice(cursor) });
};

const appendText = (tokens: RichTextToken[], value: string) => {
    value.split(/\r?\n/).forEach((line, index) => {
        if (index > 0) tokens.push({ type: "break" });
        if (line) appendInlineText(tokens, line);
    });
};

export const parseRichText = (input: string): RichTextToken[] => {
    const tokens: RichTextToken[] = [];
    const linkPattern = /\[([^\]\n]+)\]\(([^)\s]+)\)/g;
    let cursor = 0;

    for (const match of input.matchAll(linkPattern)) {
        const index = match.index ?? 0;
        appendText(tokens, input.slice(cursor, index));

        const target = parseLinkTarget(match[2]);
        if (target) {
            tokens.push({
                type: "link",
                label: match[1],
                ...target,
            });
        } else {
            appendText(tokens, match[0]);
        }
        cursor = index + match[0].length;
    }

    appendText(tokens, input.slice(cursor));
    return tokens;
};
