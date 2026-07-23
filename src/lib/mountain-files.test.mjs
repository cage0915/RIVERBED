import assert from "node:assert/strict";
import {
    mkdir,
    mkdtemp,
    readFile,
    rm,
    writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    readMountainRegion,
    writeMountainRegion,
} from "./mountain-files.ts";

async function project(t) {
    const root = await mkdtemp(path.join(os.tmpdir(), "mountain-files-"));
    const previous = process.cwd();
    await mkdir(path.join(root, "src/mountains"), { recursive: true });
    await writeFile(
        path.join(root, "src/map-contexts.json"),
        JSON.stringify({ contexts: { existing: {} } }),
    );
    process.chdir(root);
    t.after(async () => {
        process.chdir(previous);
        await rm(root, { recursive: true, force: true });
    });
    return root;
}

test("filesystem JSON errors identify the Mountain source path", async (t) => {
    const root = await project(t);
    const file = path.join(root, "src/mountains/taiwan.json");
    await writeFile(file, "not-json");

    await assert.rejects(readMountainRegion("taiwan"), new RegExp(
        `Invalid Mountain source ${file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
    ));
});

test("filesystem writes validate before replacing stored data", async (t) => {
    const root = await project(t);
    const file = path.join(root, "src/mountains/taiwan.json");
    const original = "[]\n";
    await writeFile(file, original);

    await assert.rejects(
        writeMountainRegion("taiwan", [{
            name: "山",
            elevation: null,
            description: "",
            location: { latitude: 24, longitude: 121, mapContext: "missing" },
        }]),
        /mapContext.*unknown/i,
    );
    assert.equal(await readFile(file, "utf8"), original);
});

test("filesystem writes accept a proposed context set", async (t) => {
    const root = await project(t);
    const file = path.join(root, "src/mountains/taiwan.json");
    await writeFile(file, "[]\n");

    await writeMountainRegion("taiwan", [{
        name: "山",
        elevation: null,
        description: "",
        location: { latitude: 24, longitude: 121, mapContext: "proposed" },
    }], new Set(["existing", "proposed"]));

    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(stored[0].location.mapContext, "proposed");
});
