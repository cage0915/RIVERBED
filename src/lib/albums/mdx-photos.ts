import { validateLocalPhotoFilename } from "./keys.ts";

export type MdxPhotoReference = {
    filename: string;
    offset: number;
    context: string;
};

export type MdxPhotoErrorCode =
    | "missing-item-key"
    | "dynamic-item-key"
    | "invalid-item-key"
    | "unsupported-photo-form";

export class MdxPhotoError extends Error {
    readonly code: MdxPhotoErrorCode;
    readonly offset: number;
    readonly context: string;

    constructor(code: MdxPhotoErrorCode, message: string, offset: number, context: string) {
        super(`${message} (at offset ${offset}: ${JSON.stringify(context)})`);
        this.name = "MdxPhotoError";
        this.code = code;
        this.offset = offset;
        this.context = context;
    }
}

function photoContext(body: string, start: number, end?: number): string {
    const contextEnd = end === undefined
        ? Math.min(body.length, start + 160)
        : Math.min(body.length, end + 1);
    return body.slice(start, contextEnd);
}

export function findMdxTagEnd(body: string, start: number): number {
    let quote: "'" | "\"" | null = null;
    let escaped = false;
    let braceDepth = 0;

    for (let index = start; index < body.length; index += 1) {
        const character = body[index];
        if (quote !== null) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            continue;
        }
        if (character === "'" || character === "\"") {
            quote = character;
        } else if (character === "{") {
            braceDepth += 1;
        } else if (character === "}" && braceDepth > 0) {
            braceDepth -= 1;
        } else if (character === ">" && braceDepth === 0) {
            return index;
        }
    }
    return -1;
}

function unsupported(body: string, offset: number, end?: number): MdxPhotoError {
    return new MdxPhotoError(
        "unsupported-photo-form",
        "Photo must use the supported self-closing form with a quoted itemKey",
        offset,
        photoContext(body, offset, end),
    );
}

type SourceRange = { start: number; end: number };

function isInsideRange(offset: number, ranges: SourceRange[]): boolean {
    return ranges.some(({ start, end }) => offset >= start && offset < end);
}

function findEsmEnd(body: string, start: number): number {
    let quote: "'" | "\"" | "`" | null = null;
    let escaped = false;
    let lineComment = false;
    let blockComment = false;
    let roundDepth = 0;
    let squareDepth = 0;
    let curlyDepth = 0;

    for (let index = start; index < body.length; index += 1) {
        const character = body[index];
        const next = body[index + 1];

        if (lineComment) {
            if (character !== "\n") continue;
            lineComment = false;
        } else if (blockComment) {
            if (character === "*" && next === "/") {
                blockComment = false;
                index += 1;
            }
            continue;
        } else if (quote !== null) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === quote) {
                quote = null;
            }
            continue;
        } else if (character === "/" && next === "/") {
            lineComment = true;
            index += 1;
            continue;
        } else if (character === "/" && next === "*") {
            blockComment = true;
            index += 1;
            continue;
        } else if (character === "'" || character === "\"" || character === "`") {
            quote = character;
            continue;
        } else if (character === "(") {
            roundDepth += 1;
        } else if (character === ")" && roundDepth > 0) {
            roundDepth -= 1;
        } else if (character === "[") {
            squareDepth += 1;
        } else if (character === "]" && squareDepth > 0) {
            squareDepth -= 1;
        } else if (character === "{") {
            curlyDepth += 1;
        } else if (character === "}" && curlyDepth > 0) {
            curlyDepth -= 1;
        }

        const atTopLevel = roundDepth === 0 && squareDepth === 0 && curlyDepth === 0;
        if (atTopLevel && character === ";") {
            const newline = body.indexOf("\n", index);
            return newline === -1 ? body.length : newline + 1;
        }
        if (atTopLevel && character === "\n") {
            const followingNewline = body.indexOf("\n", index + 1);
            const followingLine = body.slice(
                index + 1,
                followingNewline === -1 ? body.length : followingNewline,
            );
            if (followingLine.trim() === "") return index + 1;
        }
    }

    return body.length;
}

function collectIgnoredRanges(body: string): SourceRange[] {
    const ranges: SourceRange[] = [...body.matchAll(/\{\s*\/\*[\s\S]*?\*\/\s*\}|<!--[\s\S]*?-->/g)]
        .map((match) => ({ start: match.index, end: match.index + match[0].length }));
    const lines: Array<{ start: number; end: number; text: string }> = [];

    for (let start = 0; start < body.length;) {
        const newline = body.indexOf("\n", start);
        const end = newline === -1 ? body.length : newline + 1;
        lines.push({ start, end, text: body.slice(start, newline === -1 ? end : newline) });
        start = end;
    }

    let fence: { character: string; length: number; start: number } | undefined;
    for (const line of lines) {
        const marker = /^[ \t]{0,3}(`{3,}|~{3,})/.exec(line.text)?.[1];
        if (fence !== undefined) {
            if (
                marker?.[0] === fence.character &&
                marker.length >= fence.length &&
                line.text.slice(line.text.indexOf(marker) + marker.length).trim() === ""
            ) {
                ranges.push({ start: fence.start, end: line.end });
                fence = undefined;
            }
        } else if (marker !== undefined) {
            fence = { character: marker[0], length: marker.length, start: line.start };
        }
    }
    if (fence !== undefined) ranges.push({ start: fence.start, end: body.length });

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        if (!isInsideRange(line.start, ranges) && /^(?:import|export)\b/.test(line.text)) {
            ranges.push({ start: line.start, end: findEsmEnd(body, line.start) });
        }
    }

    for (let index = 0; index < body.length;) {
        if (body[index] !== "`" || isInsideRange(index, ranges)) {
            index += 1;
            continue;
        }
        let delimiterLength = 1;
        while (body[index + delimiterLength] === "`") delimiterLength += 1;
        const delimiter = "`".repeat(delimiterLength);
        const end = body.indexOf(delimiter, index + delimiterLength);
        if (end === -1) {
            index += delimiterLength;
            continue;
        }
        ranges.push({ start: index, end: end + delimiterLength });
        index = end + delimiterLength;
    }

    return ranges;
}

function isEscaped(body: string, offset: number): boolean {
    let backslashes = 0;
    for (let index = offset - 1; index >= 0 && body[index] === "\\"; index -= 1) {
        backslashes += 1;
    }
    return backslashes % 2 === 1;
}

function findItemKey(tag: string, body: string, tagOffset: number): string {
    let index = "<Photo".length;
    let itemKey: string | undefined;

    while (index < tag.length - 2) {
        while (/\s/.test(tag[index] ?? "")) index += 1;
        if (tag[index] === "/") {
            if (!/^\/\s*>$/.test(tag.slice(index))) {
                throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
            }
            break;
        }

        const nameStart = index;
        while (/[A-Za-z0-9:_-]/.test(tag[index] ?? "")) index += 1;
        if (index === nameStart) throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
        const name = tag.slice(nameStart, index);

        while (/\s/.test(tag[index] ?? "")) index += 1;
        if (tag[index] !== "=") continue;
        index += 1;
        while (/\s/.test(tag[index] ?? "")) index += 1;

        if (name === "itemKey" && tag[index] === "{") {
            throw new MdxPhotoError(
                "dynamic-item-key",
                "Photo itemKey must be a static quoted string, not a dynamic expression",
                tagOffset,
                tag,
            );
        }

        const quote = tag[index];
        if (quote === "'" || quote === "\"") {
            const valueStart = index + 1;
            index = valueStart;
            while (index < tag.length && tag[index] !== quote) index += 1;
            if (index >= tag.length) throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
            const value = tag.slice(valueStart, index);
            index += 1;
            if (index < tag.length && !/\s|\//.test(tag[index])) {
                throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
            }
            if (name === "itemKey") {
                if (itemKey !== undefined) throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
                itemKey = value;
            }
            continue;
        }

        if (name === "itemKey") throw unsupported(body, tagOffset, tagOffset + tag.length - 1);

        if (tag[index] === "{") {
            let depth = 0;
            do {
                if (tag[index] === "{") depth += 1;
                if (tag[index] === "}") depth -= 1;
                index += 1;
            } while (index < tag.length && depth > 0);
            if (depth !== 0) throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
            if (index < tag.length && !/\s|\//.test(tag[index])) {
                throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
            }
        } else {
            throw unsupported(body, tagOffset, tagOffset + tag.length - 1);
        }
    }

    if (itemKey === undefined) {
        throw new MdxPhotoError(
            "missing-item-key",
            "Photo requires a static quoted itemKey attribute",
            tagOffset,
            tag,
        );
    }
    return itemKey;
}

export function extractMdxPhotos(body: string): MdxPhotoReference[] {
    const references: MdxPhotoReference[] = [];
    const ignoredRanges = collectIgnoredRanges(body);
    const photoStart = /<Photo(?=\s|\/?>)/g;

    for (let match = photoStart.exec(body); match !== null; match = photoStart.exec(body)) {
        const offset = match.index;
        if (isInsideRange(offset, ignoredRanges) || isEscaped(body, offset)) continue;
        const end = findMdxTagEnd(body, offset + match[0].length);
        if (end === -1) throw unsupported(body, offset);

        const tag = body.slice(offset, end + 1);
        if (!/\/\s*>$/.test(tag)) throw unsupported(body, offset, end);
        const filename = findItemKey(tag, body, offset);

        try {
            validateLocalPhotoFilename(filename);
        } catch {
            throw new MdxPhotoError(
                "invalid-item-key",
                `Photo itemKey must be a valid local filename: ${JSON.stringify(filename)}`,
                offset,
                tag,
            );
        }

        references.push({ filename, offset, context: tag });
        photoStart.lastIndex = end + 1;
    }

    return references;
}
