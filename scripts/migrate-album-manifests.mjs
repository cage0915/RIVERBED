import path from "node:path";
import { pathToFileURL } from "node:url";

import {
    createLegacyMigrationPlan,
    validateAlbumManifests,
    writeAlbumManifests,
} from "../src/lib/albums/legacy-source.js";

function printDiagnostics(diagnostics, projectRoot, stderr) {
    for (const item of diagnostics) {
        const sourcePath = path.relative(projectRoot, item.sourcePath).split(path.sep).join("/");
        const manifestPath = path.relative(projectRoot, item.manifestPath).split(path.sep).join("/");
        stderr(`[${item.code}] ${item.albumSlug} ${sourcePath} ${item.fieldPath}: ${item.message} (manifest: ${manifestPath})`);
    }
}

export function runMigrationCli({
    mode,
    projectRoot = process.cwd(),
    stdout = console.log,
    stderr = console.error,
}) {
    try {
        if (mode === "check") {
            const plan = createLegacyMigrationPlan(projectRoot);
            for (const { manifestPath } of plan.candidates) {
                stdout(path.relative(projectRoot, manifestPath).split(path.sep).join("/"));
            }
            printDiagnostics(plan.diagnostics, projectRoot, stderr);
            stdout(`${plan.candidates.length}/${plan.albumCount} candidate manifests, ${plan.diagnostics.length} diagnostics`);
            return plan.diagnostics.length > 0 ? 1 : 0;
        }
        if (mode === "write") {
            const plan = createLegacyMigrationPlan(projectRoot);
            printDiagnostics(plan.diagnostics, projectRoot, stderr);
            const result = writeAlbumManifests(plan);
            stdout(`${result.written} manifests written, ${result.unchanged} unchanged`);
            return 0;
        }
        if (mode === "validate") {
            const result = validateAlbumManifests(projectRoot);
            printDiagnostics(result.diagnostics, projectRoot, stderr);
            stdout(`${result.equivalentCount}/${result.albumCount} manifests equivalent, ${result.diagnostics.length} diagnostics`);
            return result.diagnostics.length > 0 ? 1 : 0;
        }
        throw new Error("Usage: node scripts/migrate-album-manifests.mjs <check|write|validate>");
    } catch (error) {
        stderr(error instanceof Error ? error.message : String(error));
        return 1;
    }
}

export function main(argv = process.argv, io = {}) {
    return runMigrationCli({ ...io, mode: argv[2] });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    process.exitCode = main();
}
