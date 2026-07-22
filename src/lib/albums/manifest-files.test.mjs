import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { parseTagMapInput } from "../dev-tag-state.js";

import {
    AlbumManifestMutationError,
    readAlbumManifestFile,
    readAllAlbumManifestFiles,
    reorderFolderAlbums,
    replaceAlbumPhotoTags,
    mutateAlbumManifestFile,
    mutateAlbumManifestFiles,
    updateAlbumCover,
    updatePhotoCaption,
    updatePhotoTags,
    writeAlbumManifestFile,
} from "./manifest-files.ts";

const albumSlug = "yama/sample-album";

function manifest(overrides = {}) {
    return {
        schemaVersion: 1,
        title: "Sample",
        order: 10,
        cover: {
            photo: { kind: "local", filename: "cover.jpg" },
            zoom: 1,
            offset: { x: 50, y: 50 },
        },
        photos: [
            { filename: "cover.jpg", tags: [] },
            { filename: "view.jpg", tags: [] },
        ],
        ...overrides,
    };
}

async function tempProject() {
    const root = await mkdtemp(path.join(tmpdir(), "riverbed-manifests-"));
    const directory = path.join(root, "src", "album-manifests", "yama");
    await mkdir(directory, { recursive: true });
    return {
        root,
        file: path.join(directory, "sample-album.json"),
    };
}

test("manifest file helpers read schema-valid files below an explicit project root", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");

    const loaded = await readAlbumManifestFile(project.root, albumSlug);
    assert.equal(loaded.title, "Sample");
    assert.deepEqual(loaded.photos.map(({ filename, tags }) => ({ filename, tags })), [
        { filename: "cover.jpg", tags: [] },
        { filename: "view.jpg", tags: [] },
    ]);
    await assert.rejects(
        readAlbumManifestFile(project.root, "../outside"),
        /Invalid album slug/,
    );
});

test("readAllAlbumManifestFiles returns slug-keyed manifests in stable order", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");
    const otherDirectory = path.join(project.root, "src", "album-manifests", "k");
    await mkdir(otherDirectory, { recursive: true });
    await writeFile(
        path.join(otherDirectory, "another.json"),
        JSON.stringify(manifest({ title: "Another" })),
        "utf8",
    );

    const manifests = await readAllAlbumManifestFiles(project.root);

    assert.deepEqual(Object.keys(manifests), ["k/another", "yama/sample-album"]);
    assert.equal(manifests["k/another"].title, "Another");
});

test("writeAlbumManifestFile serializes validated manifests deterministically", async () => {
    const project = await tempProject();

    await writeAlbumManifestFile(project.root, albumSlug, manifest());

    assert.equal(
        await readFile(project.file, "utf8"),
        `${JSON.stringify(manifest(), null, 2)}\n`,
    );
});

test("writeAlbumManifestFile does not replace the existing file when validation fails", async () => {
    const project = await tempProject();
    const original = `${JSON.stringify(manifest(), null, 2)}\n`;
    await writeFile(project.file, original, "utf8");

    await assert.rejects(
        writeAlbumManifestFile(project.root, albumSlug, manifest({ title: "" })),
        /title must not be empty/,
    );
    assert.equal(await readFile(project.file, "utf8"), original);
    assert.deepEqual(await readdir(path.dirname(project.file)), ["sample-album.json"]);
});

test("manifest writes reject symlinked storage components without escaping the project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "riverbed-symlink-root-"));
    const external = await mkdtemp(path.join(tmpdir(), "riverbed-symlink-external-"));
    const manifestsRoot = path.join(root, "src", "album-manifests");
    await mkdir(manifestsRoot, { recursive: true });
    await symlink(external, path.join(manifestsRoot, "yama"));

    await assert.rejects(
        writeAlbumManifestFile(root, albumSlug, manifest()),
        /symlink/i,
    );
    await assert.rejects(lstat(path.join(external, "sample-album.json")), /ENOENT/);
});

test("manifest scans reject JSON symlinks instead of silently following or ignoring them", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");
    const external = path.join(await mkdtemp(path.join(tmpdir(), "riverbed-read-external-")), "outside.json");
    await writeFile(external, JSON.stringify(manifest({ title: "Outside" })), "utf8");
    await symlink(external, path.join(path.dirname(project.file), "linked.json"));

    await assert.rejects(
        readAllAlbumManifestFiles(project.root),
        /symlink/i,
    );
});

test("updatePhotoTags validates the local filename and atomically replaces one photo's tags", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");

    const updated = await updatePhotoTags(project.root, albumSlug, "view.jpg", [
        { name: "Snow Peak", x: 12.345, y: 67.891 },
    ]);

    assert.deepEqual(updated.photos[1].tags, [
        { name: "Snow Peak", x: 12.345, y: 67.891 },
    ]);
    assert.deepEqual((await readAlbumManifestFile(project.root, albumSlug)).photos[1].tags, [
        { name: "Snow Peak", x: 12.345, y: 67.891 },
    ]);
    await assert.rejects(
        updatePhotoTags(project.root, albumSlug, "../view.jpg", []),
        /Invalid local filename/,
    );
    await assert.rejects(
        updatePhotoTags(project.root, albumSlug, "missing.jpg", []),
        /Photo not found/,
    );
});

test("replaceAlbumPhotoTags applies a complete tag map in one validated manifest write", async () => {
    const project = await tempProject();
    await writeFile(
        project.file,
        JSON.stringify(manifest({
            photos: [
                { filename: "cover.jpg", tags: [{ name: "Old", x: 1, y: 2 }] },
                { filename: "view.jpg", tags: [{ name: "Remove", x: 3, y: 4 }] },
            ],
        })),
        "utf8",
    );

    await replaceAlbumPhotoTags(project.root, albumSlug, {
        "cover.jpg": [{ name: "New", x: 10, y: 20 }],
    });

    const loaded = await readAlbumManifestFile(project.root, albumSlug);
    assert.deepEqual(loaded.photos.map(({ filename, tags }) => ({ filename, tags })), [
        { filename: "cover.jpg", tags: [{ name: "New", x: 10, y: 20 }] },
        { filename: "view.jpg", tags: [] },
    ]);
    await assert.rejects(
        replaceAlbumPhotoTags(project.root, albumSlug, { "missing.jpg": [] }),
        /Photo not found/,
    );
});

test("save-tags pipeline rejects invalid and unknown empty keys without clearing existing tags", async () => {
    const project = await tempProject();
    const originalManifest = manifest({
        photos: [
            { filename: "cover.jpg", tags: [{ name: "Keep", x: 10, y: 20 }] },
            { filename: "view.jpg", tags: [] },
        ],
    });
    const original = `${JSON.stringify(originalManifest, null, 2)}\n`;
    await writeFile(project.file, original, "utf8");

    assert.throws(
        () => parseTagMapInput({ "../bad.jpg": [] }),
        /Invalid local filename/,
    );
    assert.equal(await readFile(project.file, "utf8"), original);

    const unknownPhotoMap = parseTagMapInput({ "missing.jpg": [] });
    await assert.rejects(
        replaceAlbumPhotoTags(project.root, albumSlug, unknownPhotoMap),
        /Photo not found/,
    );
    assert.equal(await readFile(project.file, "utf8"), original);
    assert.deepEqual(await readdir(path.dirname(project.file)), ["sample-album.json"]);
});

test("updatePhotoCaption writes photo captions and deletion leaves MDX-owned block captions alone", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");
    const mdxFile = path.join(project.root, "src", "content", "albums", "yama", "sample-album.mdx");
    await mkdir(path.dirname(mdxFile), { recursive: true });
    const mdx = '<Row caption="Block caption"><Photo itemKey="view.jpg" /></Row>\n';
    await writeFile(mdxFile, mdx, "utf8");

    await updatePhotoCaption(project.root, albumSlug, "view.jpg", "Photo caption");
    assert.equal((await readAlbumManifestFile(project.root, albumSlug)).photos[1].caption, "Photo caption");
    await updatePhotoCaption(project.root, albumSlug, "view.jpg", "   ");
    assert.equal((await readAlbumManifestFile(project.root, albumSlug)).photos[1].caption, undefined);
    assert.equal(await readFile(mdxFile, "utf8"), mdx);
});

test("concurrent caption and tag mutations serialize per manifest without losing either update", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");
    let releaseFirst;
    const firstMayFinish = new Promise((resolve) => { releaseFirst = resolve; });
    let firstStarted;
    const firstDidStart = new Promise((resolve) => { firstStarted = resolve; });
    const holdingMutation = mutateAlbumManifestFile(project.root, albumSlug, async (current) => {
        firstStarted();
        await firstMayFinish;
        return current;
    });
    await firstDidStart;

    const captionMutation = updatePhotoCaption(
        project.root,
        albumSlug,
        "view.jpg",
        "Concurrent caption",
    );
    const tagMutation = updatePhotoTags(project.root, albumSlug, "view.jpg", [
        { name: "Concurrent tag", x: 10, y: 20 },
    ]);
    const unrelatedDirectory = path.join(project.root, "src", "album-manifests", "k");
    await mkdir(unrelatedDirectory, { recursive: true });
    await writeFile(
        path.join(unrelatedDirectory, "other.json"),
        JSON.stringify(manifest({ title: "Unrelated" })),
        "utf8",
    );
    const unrelatedMutation = updatePhotoCaption(
        project.root,
        "k/other",
        "view.jpg",
        "Unrelated caption",
    );
    await Promise.race([
        unrelatedMutation,
        new Promise((_, reject) => setTimeout(
            () => reject(new Error("unrelated Album mutation was blocked")),
            250,
        )),
    ]);
    releaseFirst();
    await Promise.all([holdingMutation, captionMutation, tagMutation]);

    const photo = (await readAlbumManifestFile(project.root, albumSlug)).photos[1];
    assert.equal(photo.caption, "Concurrent caption");
    assert.deepEqual(photo.tags, [{ name: "Concurrent tag", x: 10, y: 20 }]);
    assert.equal(
        (await readAlbumManifestFile(project.root, "k/other")).photos[1].caption,
        "Unrelated caption",
    );
});

test("a failed manifest mutation releases the per-file queue", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");

    await assert.rejects(
        mutateAlbumManifestFile(project.root, albumSlug, (current) => ({
            ...current,
            title: "",
        })),
        /title must not be empty/,
    );
    await updatePhotoCaption(project.root, albumSlug, "view.jpg", "Queue recovered");

    assert.equal(
        (await readAlbumManifestFile(project.root, albumSlug)).photos[1].caption,
        "Queue recovered",
    );
});

test("updateAlbumCover stores same-Album resolved keys locally and keeps crop on the consumer", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");

    const updated = await updateAlbumCover(project.root, albumSlug, {
        assetKey: "yama/sample-album/view.jpg",
        zoom: 1.75,
        offset: { x: 25, y: 80 },
    });

    assert.deepEqual(updated.cover, {
        photo: { kind: "local", filename: "view.jpg" },
        zoom: 1.75,
        offset: { x: 25, y: 80 },
    });
});

test("updateAlbumCover stores another tracked Album photo externally without copying metadata", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");
    const consumerPhotos = (await readAlbumManifestFile(project.root, albumSlug)).photos;
    const sourceDirectory = path.join(project.root, "src", "album-manifests", "k");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(
        path.join(sourceDirectory, "source.json"),
        JSON.stringify(manifest({
            title: "Source",
            photos: [
                { filename: "cover.jpg", tags: [] },
                { filename: "shared.jpg", caption: "Source caption", tags: [{ name: "Peak", x: 10, y: 20 }] },
            ],
        })),
        "utf8",
    );

    const updated = await updateAlbumCover(project.root, albumSlug, {
        assetKey: "k/source/shared.jpg",
        zoom: 1.2,
        offset: { x: 40, y: 60 },
    });

    assert.deepEqual(updated.cover, {
        photo: { kind: "external", assetKey: "k/source/shared.jpg" },
        zoom: 1.2,
        offset: { x: 40, y: 60 },
    });
    assert.deepEqual(updated.photos, consumerPhotos);
    const source = await readAlbumManifestFile(project.root, "k/source");
    assert.equal(source.photos[1].caption, "Source caption");
});

test("updateAlbumCover rejects unresolved keys and leaves the consumer unchanged", async () => {
    const project = await tempProject();
    const original = `${JSON.stringify(manifest(), null, 2)}\n`;
    await writeFile(project.file, original, "utf8");

    await assert.rejects(
        updateAlbumCover(project.root, albumSlug, {
            assetKey: "k/missing/photo.jpg",
            zoom: 1,
            offset: { x: 50, y: 50 },
        }),
        /not tracked/i,
    );
    await assert.rejects(
        updateAlbumCover(project.root, albumSlug, {
            assetKey: "yama/sample-album/missing.jpg",
            zoom: 1,
            offset: { x: 50, y: 50 },
        }),
        /not tracked/i,
    );
    assert.equal(await readFile(project.file, "utf8"), original);
});

test("updateAlbumCover reports a valid missing consumer separately from an untracked source", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");

    await assert.rejects(
        updateAlbumCover(project.root, "yama/missing", {
            assetKey: "yama/sample-album/view.jpg",
            zoom: 1,
            offset: { x: 50, y: 50 },
        }),
        (error) => error instanceof AlbumManifestMutationError && error.code === "album-not-found",
    );
    await assert.rejects(
        updateAlbumCover(project.root, albumSlug, {
            assetKey: "k/missing/photo.jpg",
            zoom: 1,
            offset: { x: 50, y: 50 },
        }),
        (error) => error instanceof AlbumManifestMutationError && error.code === "cover-untracked",
    );
});

async function folderProject() {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest({ order: 40 })), "utf8");
    await writeFile(
        path.join(path.dirname(project.file), "second.json"),
        JSON.stringify(manifest({ title: "Second", order: 10 })),
        "utf8",
    );
    await writeFile(
        path.join(path.dirname(project.file), "third.json"),
        JSON.stringify(manifest({ title: "Third", order: 90 })),
        "utf8",
    );
    return project;
}

test("reorderFolderAlbums requires the complete unique folder list and assigns 10-point order values", async () => {
    const project = await folderProject();

    const updated = await reorderFolderAlbums(project.root, "yama", [
        "yama/third",
        "yama/sample-album",
        "yama/second",
    ]);

    assert.deepEqual(updated.map(({ slug, manifest }) => [slug, manifest.order]), [
        ["yama/third", 10],
        ["yama/sample-album", 20],
        ["yama/second", 30],
    ]);
    assert.equal((await readAlbumManifestFile(project.root, "yama/third")).order, 10);
    assert.equal((await readAlbumManifestFile(project.root, albumSlug)).order, 20);
    assert.equal((await readAlbumManifestFile(project.root, "yama/second")).order, 30);

    for (const order of [
        ["yama/sample-album", "yama/second"],
        ["yama/sample-album", "yama/second", "yama/second"],
        ["yama/sample-album", "yama/second", "k/third"],
        ["yama/sample-album", "yama/second", "yama/missing"],
    ]) {
        await assert.rejects(reorderFolderAlbums(project.root, "yama", order), /complete|duplicate|folder|unknown/i);
    }
});

test("reorderFolderAlbums validates every proposal before replacing any manifest", async () => {
    const project = await folderProject();
    const sampleBefore = await readFile(project.file, "utf8");
    const secondFile = path.join(path.dirname(project.file), "second.json");
    const secondBefore = await readFile(secondFile, "utf8");

    await assert.rejects(
        mutateAlbumManifestFiles(
            project.root,
            ["yama/sample-album", "yama/second"],
            (manifests) => ({
                "yama/sample-album": { ...manifests["yama/sample-album"], order: 20 },
                "yama/second": { ...manifests["yama/second"], title: "", order: 10 },
            }),
        ),
        /title must not be empty/,
    );

    assert.equal(await readFile(project.file, "utf8"), sampleBefore);
    assert.equal(await readFile(secondFile, "utf8"), secondBefore);
});

test("folder reorder serializes with overlapping single-manifest mutations", async () => {
    const project = await folderProject();
    let releaseFirst;
    const firstMayFinish = new Promise((resolve) => { releaseFirst = resolve; });
    let firstStarted;
    const firstDidStart = new Promise((resolve) => { firstStarted = resolve; });
    const holdingMutation = mutateAlbumManifestFile(project.root, albumSlug, async (current) => {
        firstStarted();
        await firstMayFinish;
        return { ...current, info: "Concurrent info" };
    });
    await firstDidStart;

    const reorder = reorderFolderAlbums(project.root, "yama", [
        "yama/third",
        "yama/second",
        "yama/sample-album",
    ]);
    releaseFirst();
    await Promise.all([holdingMutation, reorder]);

    const updated = await readAlbumManifestFile(project.root, albumSlug);
    assert.equal(updated.info, "Concurrent info");
    assert.equal(updated.order, 30);
});

test("multi-manifest replacement rolls back an earlier replacement when a later rename fails", async () => {
    const project = await folderProject();
    const firstFile = project.file;
    const secondFile = path.join(path.dirname(project.file), "second.json");
    const firstBefore = await readFile(firstFile, "utf8");
    const secondBefore = await readFile(secondFile, "utf8");
    const { rename: realRename, unlink: realUnlink } = await import("node:fs/promises");
    let failed = false;

    await assert.rejects(mutateAlbumManifestFiles(
        project.root,
        [albumSlug, "yama/second"],
        (manifests) => ({
            [albumSlug]: { ...manifests[albumSlug], order: 20 },
            "yama/second": { ...manifests["yama/second"], order: 10 },
        }),
        {
            rename: async (source, target) => {
                if (!failed && source.endsWith(".tmp") && target === secondFile) {
                    failed = true;
                    throw Object.assign(new Error("injected second replacement failure"), { code: "EIO" });
                }
                return realRename(source, target);
            },
            unlink: realUnlink,
        },
    ), /injected second replacement failure/);

    assert.equal(await readFile(firstFile, "utf8"), firstBefore);
    assert.equal(await readFile(secondFile, "utf8"), secondBefore);
    assert.deepEqual((await readdir(path.dirname(firstFile))).sort(), ["sample-album.json", "second.json", "third.json"]);
});

test("rollback failure is explicit and preserves the original backup for recovery", async () => {
    const project = await folderProject();
    const firstFile = project.file;
    const secondFile = path.join(path.dirname(project.file), "second.json");
    const firstBefore = await readFile(firstFile, "utf8");
    const { rename: realRename, unlink: realUnlink } = await import("node:fs/promises");
    let replacementFailed = false;

    await assert.rejects(mutateAlbumManifestFiles(
        project.root,
        [albumSlug, "yama/second"],
        (manifests) => ({
            [albumSlug]: { ...manifests[albumSlug], order: 20 },
            "yama/second": { ...manifests["yama/second"], order: 10 },
        }),
        {
            rename: async (source, target) => {
                if (!replacementFailed && source.endsWith(".tmp") && target === secondFile) {
                    replacementFailed = true;
                    throw new Error("injected replacement failure");
                }
                if (replacementFailed && source.endsWith(".bak") && target === firstFile) {
                    throw new Error("injected rollback failure");
                }
                return realRename(source, target);
            },
            unlink: realUnlink,
        },
    ), /rollback incomplete/i);

    const backups = (await readdir(path.dirname(firstFile))).filter((name) => name.endsWith(".bak"));
    assert.equal(backups.length, 1);
    assert.equal(await readFile(path.join(path.dirname(firstFile), backups[0]), "utf8"), firstBefore);
});

test("external cover validation waits for and observes source inventory mutations", async () => {
    const project = await tempProject();
    await writeFile(project.file, JSON.stringify(manifest()), "utf8");
    const sourceDirectory = path.join(project.root, "src", "album-manifests", "k");
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, "source.json"), JSON.stringify(manifest({
        photos: [{ filename: "cover.jpg", tags: [] }, { filename: "shared.jpg", tags: [] }],
    })), "utf8");
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let started;
    const didStart = new Promise((resolve) => { started = resolve; });
    const sourceMutation = mutateAlbumManifestFile(project.root, "k/source", async (current) => {
        started();
        await held;
        return { ...current, photos: current.photos.filter(({ filename }) => filename !== "shared.jpg") };
    });
    await didStart;
    const coverMutation = updateAlbumCover(project.root, albumSlug, {
        assetKey: "k/source/shared.jpg",
        zoom: 1,
        offset: { x: 50, y: 50 },
    });
    release();
    await sourceMutation;
    await assert.rejects(coverMutation, /not tracked/i);
});

test("folder ordering snapshots membership after earlier folder writes complete", async () => {
    const project = await folderProject();
    let release;
    const held = new Promise((resolve) => { release = resolve; });
    let started;
    const didStart = new Promise((resolve) => { started = resolve; });
    const holdingMutation = mutateAlbumManifestFile(project.root, albumSlug, async (current) => {
        started();
        await held;
        return current;
    });
    await didStart;
    const createFourth = writeAlbumManifestFile(
        project.root,
        "yama/fourth",
        manifest({ title: "Fourth", order: 100 }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    const reorder = reorderFolderAlbums(project.root, "yama", [
        "yama/third",
        "yama/second",
        albumSlug,
    ]);
    release();
    await Promise.all([holdingMutation, createFourth]);
    await assert.rejects(reorder, /complete folder Album list/i);
});
