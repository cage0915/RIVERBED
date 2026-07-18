import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, "..");
const sourceRoot = path.join(projectRoot, "public", "contours");
const publicAssetRoot = path.join(projectRoot, "public", "contour-assets");
const builtSourceRoot = path.join(projectRoot, "dist", "contours");

const encodeAssetName = (name) =>
  Buffer.from(name.normalize("NFC"), "utf8").toString("hex");

async function prepare() {
  await rm(publicAssetRoot, { recursive: true, force: true });

  const regions = await readdir(sourceRoot, { withFileTypes: true });
  for (const region of regions) {
    if (!region.isDirectory()) continue;
    const sourceRegion = path.join(sourceRoot, region.name);
    const assetRegion = path.join(publicAssetRoot, region.name);
    await mkdir(assetRegion, { recursive: true });

    const files = await readdir(sourceRegion, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile() || path.extname(file.name) !== ".svg") continue;
      const mountainName = path.basename(file.name, ".svg");
      await cp(
        path.join(sourceRegion, file.name),
        path.join(assetRegion, `${encodeAssetName(mountainName)}.svg`),
      );
    }
  }
}

async function cleanup() {
  await rm(publicAssetRoot, { recursive: true, force: true });

  const builtEntries = await readdir(builtSourceRoot, { withFileTypes: true }).catch(
    () => [],
  );
  await Promise.all(
    builtEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        rm(path.join(builtSourceRoot, entry.name), {
          recursive: true,
          force: true,
        }),
      ),
  );
}

const command = process.argv[2];
if (command === "prepare") {
  await prepare();
} else if (command === "cleanup") {
  await cleanup();
} else {
  throw new Error("Expected prepare or cleanup");
}
