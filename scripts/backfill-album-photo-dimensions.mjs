import fs from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

const projectRoot = process.cwd();
const manifestRoot = path.join(projectRoot, "src", "album-manifests");
const localPhotoRoot = path.join(projectRoot, "r2");
const remotePhotoRoot = "https://photos.cage0915.com";

async function walkJsonFiles(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const nested = await Promise.all(entries.map((entry) => {
        const resolved = path.join(directory, entry.name);
        if (entry.isDirectory()) return walkJsonFiles(resolved);
        return entry.isFile() && entry.name.endsWith(".json") ? [resolved] : [];
    }));
    return nested.flat().sort();
}

function encodeAssetKey(assetKey) {
    return assetKey.split("/").map(encodeURIComponent).join("/");
}

async function readDimensions(assetKey) {
    const localPath = path.join(localPhotoRoot, ...assetKey.split("/"));
    try {
        await fs.access(localPath);
        const metadata = await sharp(localPath).metadata();
        if (!metadata.width || !metadata.height) {
            throw new Error(`Invalid local image metadata for ${assetKey}`);
        }
        return { width: metadata.width, height: metadata.height };
    } catch (error) {
        if (error?.code !== "ENOENT") throw error;
    }

    const response = await fetch(
        `${remotePhotoRoot}/cdn-cgi/image/format=json/${encodeAssetKey(assetKey)}`,
    );
    if (!response.ok) {
        throw new Error(`Unable to read image metadata for ${assetKey}: ${response.status}`);
    }
    const metadata = await response.json();
    if (!Number.isInteger(metadata.width) || !Number.isInteger(metadata.height)) {
        throw new Error(`Invalid image metadata for ${assetKey}`);
    }
    return { width: metadata.width, height: metadata.height };
}

async function mapWithConcurrency(items, concurrency, mapper) {
    const results = new Array(items.length);
    let nextIndex = 0;
    async function worker() {
        while (nextIndex < items.length) {
            const index = nextIndex++;
            results[index] = await mapper(items[index], index);
        }
    }
    await Promise.all(Array.from({ length: concurrency }, worker));
    return results;
}

const manifestFiles = await walkJsonFiles(manifestRoot);
let updatedPhotos = 0;
let unchangedPhotos = 0;

await mapWithConcurrency(manifestFiles, 8, async (manifestFile) => {
    const relative = path.relative(manifestRoot, manifestFile).split(path.sep).join("/");
    const albumSlug = relative.replace(/\.json$/, "");
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    let changed = false;

    manifest.photos = await mapWithConcurrency(manifest.photos, 4, async (photo) => {
        if (Number.isInteger(photo.width) && Number.isInteger(photo.height)) {
            unchangedPhotos += 1;
            return photo;
        }
        const dimensions = await readDimensions(`${albumSlug}/${photo.filename}`);
        const { filename, width: _width, height: _height, ...rest } = photo;
        changed = true;
        updatedPhotos += 1;
        return { filename, ...dimensions, ...rest };
    });

    if (changed) {
        await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    }
});

console.log(
    `Album photo dimensions ready: ${updatedPhotos} updated, ${unchangedPhotos} unchanged`,
);
