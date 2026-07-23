import assert from "node:assert/strict";
import {
    mkdtemp,
    readFile,
    readdir,
    rename,
    rm,
    unlink,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { commitTextFiles } from "./source-transaction.ts";

const temporaryDirectory = async () =>
    mkdtemp(path.join(os.tmpdir(), "source-transaction-"));

test("commits multiple text files as one transaction", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = path.join(root, "first.json");
    const second = path.join(root, "second.json");
    await Promise.all([writeFile(first, "old-first"), writeFile(second, "old-second")]);

    await commitTextFiles([
        { target: first, contents: "new-first" },
        { target: second, contents: "new-second" },
    ]);

    assert.equal(await readFile(first, "utf8"), "new-first");
    assert.equal(await readFile(second, "utf8"), "new-second");
    assert.deepEqual((await readdir(root)).sort(), ["first.json", "second.json"]);
});

test("rolls every file back when a replacement fails", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const first = path.join(root, "first.json");
    const second = path.join(root, "second.json");
    await Promise.all([writeFile(first, "old-first"), writeFile(second, "old-second")]);

    await assert.rejects(
        commitTextFiles(
            [
                { target: first, contents: "new-first" },
                { target: second, contents: "new-second" },
            ],
            {
                writeFile,
                unlink,
                rename: async (source, target) => {
                    if (target === second && source.includes(".tmp")) {
                        throw new Error("injected replacement failure");
                    }
                    await rename(source, target);
                },
            },
        ),
        /injected replacement failure/,
    );

    assert.equal(await readFile(first, "utf8"), "old-first");
    assert.equal(await readFile(second, "utf8"), "old-second");
    assert.deepEqual((await readdir(root)).sort(), ["first.json", "second.json"]);
});

test("serializes overlapping transactions in call order", async (t) => {
    const root = await temporaryDirectory();
    t.after(() => rm(root, { recursive: true, force: true }));
    const target = path.join(root, "source.json");
    await writeFile(target, "initial");

    await Promise.all([
        commitTextFiles([{ target, contents: "first" }]),
        commitTextFiles([{ target, contents: "second" }]),
    ]);

    assert.equal(await readFile(target, "utf8"), "second");
});
