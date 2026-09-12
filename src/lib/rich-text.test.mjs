import assert from "node:assert/strict";
import test from "node:test";

import { parseRichText } from "./rich-text.ts";

test("rich text preserves line breaks and parses internal and external links", () => {
    assert.deepEqual(
        parseRichText("第一行\n[站內](/tags/大霸尖山) 與 [外部](https://example.com/path)"),
        [
            { type: "text", value: "第一行" },
            { type: "break" },
            { type: "link", label: "站內", href: "/tags/大霸尖山", external: false },
            { type: "text", value: " 與 " },
            {
                type: "link",
                label: "外部",
                href: "https://example.com/path",
                external: true,
            },
        ],
    );
});

test("rich text leaves unsafe link targets as plain text", () => {
    assert.deepEqual(parseRichText("[不要點](javascript:alert)"), [
        { type: "text", value: "[不要點](javascript:alert)" },
    ]);
});

test("rich text parses bold and italic Markdown without interpreting unmatched markers", () => {
    assert.deepEqual(
        parseRichText("普通 **粗體**、*斜體* 與 **沒有結束"),
        [
            { type: "text", value: "普通 " },
            { type: "strong", value: "粗體" },
            { type: "text", value: "、" },
            { type: "emphasis", value: "斜體" },
            { type: "text", value: " 與 **沒有結束" },
        ],
    );
});
