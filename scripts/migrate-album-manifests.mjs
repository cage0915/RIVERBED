import path from "node:path";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

import {
    createLegacyMigrationPlan,
    parseLegacyFrontmatter,
    validateAlbumMigrationPlan,
    validateAlbumManifests,
    writeAlbumManifests,
} from "../src/lib/albums/legacy-source.js";

function removeArtifact(operations, filename, errors) {
    try {
        if (operations.existsSync(filename)) operations.unlinkSync(filename);
    } catch (error) {
        errors.push(error);
    }
}

export class AlbumCleanupConflictError extends Error {
    constructor(filename) {
        super(`Album MDX source changed after final cleanup plan creation: ${filename}`);
        this.name = "AlbumCleanupConflictError";
        this.code = "album-mdx-source-conflict";
    }
}

export function cleanupAlbumMdxTransaction(plan, operationOverrides = {}) {
    const operations = { ...fs, ...operationOverrides };
    const validation = validateAlbumMigrationPlan(plan);
    if (validation.diagnostics.length > 0 || validation.equivalentCount !== validation.albumCount) {
        throw new Error("Refusing to clean MDX before every final-plan manifest is equivalent");
    }

    const entries = plan.candidates.map((candidate, index) => {
        const original = operations.readFileSync(candidate.mdxPath);
        const source = original.toString("utf8");
        if (source !== candidate.mdxSource) {
            throw new AlbumCleanupConflictError(candidate.mdxPath);
        }
        parseLegacyFrontmatter(source);
        const content = `---\n---\n${candidate.mdxBody}`;
        const suffix = `.cleanup-${process.pid}-${index}`;
        return {
            candidate,
            original,
            content,
            tempPath: `${candidate.mdxPath}${suffix}.tmp`,
            backupPath: `${candidate.mdxPath}${suffix}.bak`,
            tempAttempted: false,
            staged: false,
            backupMade: false,
            replaced: false,
        };
    });

    try {
        for (const entry of entries) {
            if (operations.existsSync(entry.tempPath) || operations.existsSync(entry.backupPath)) {
                throw new Error(`Refusing to reuse cleanup artifact path: ${entry.candidate.mdxPath}`);
            }
            entry.tempAttempted = true;
            operations.writeFileSync(entry.tempPath, entry.content, { encoding: "utf8", flag: "wx" });
            entry.staged = true;
            const staged = operations.readFileSync(entry.tempPath, "utf8");
            if (staged !== entry.content || !staged.endsWith(entry.candidate.mdxBody)) {
                throw new Error(`Staged MDX verification failed: ${entry.candidate.mdxPath}`);
            }
        }
    } catch (cause) {
        const cleanupErrors = [];
        for (const entry of entries) {
            if (entry.tempAttempted) removeArtifact(operations, entry.tempPath, cleanupErrors);
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError([cause, ...cleanupErrors], "MDX staging failed and temporary cleanup was incomplete");
        }
        throw cause;
    }

    try {
        for (const entry of entries) {
            const current = operations.readFileSync(entry.candidate.mdxPath);
            if (!Buffer.from(current).equals(Buffer.from(entry.original))) {
                throw new AlbumCleanupConflictError(entry.candidate.mdxPath);
            }
        }
    } catch (cause) {
        const cleanupErrors = [];
        for (const entry of entries) {
            if (entry.tempAttempted) removeArtifact(operations, entry.tempPath, cleanupErrors);
        }
        if (cleanupErrors.length > 0) {
            throw new AggregateError(
                [cause, ...cleanupErrors],
                "MDX changed before cleanup commit and temporary cleanup was incomplete",
            );
        }
        throw cause;
    }

    try {
        for (const entry of entries) {
            operations.renameSync(entry.candidate.mdxPath, entry.backupPath);
            entry.backupMade = true;
            operations.renameSync(entry.tempPath, entry.candidate.mdxPath);
            entry.staged = false;
            entry.replaced = true;
        }
    } catch (cause) {
        const rollbackErrors = [];
        for (const entry of [...entries].reverse()) {
            try {
                if (entry.replaced && operations.existsSync(entry.candidate.mdxPath)) {
                    operations.unlinkSync(entry.candidate.mdxPath);
                }
                if (entry.backupMade && operations.existsSync(entry.backupPath)) {
                    operations.renameSync(entry.backupPath, entry.candidate.mdxPath);
                    entry.backupMade = false;
                    entry.replaced = false;
                }
            } catch (error) {
                rollbackErrors.push(error);
            }
            if (entry.tempAttempted) removeArtifact(operations, entry.tempPath, rollbackErrors);
        }
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [cause, ...rollbackErrors],
                "MDX cleanup commit failed and rollback was incomplete; .bak recovery artifacts were preserved",
            );
        }
        throw cause;
    }

    const cleanupErrors = [];
    for (const entry of entries) removeArtifact(operations, entry.backupPath, cleanupErrors);
    if (cleanupErrors.length > 0) {
        throw new AggregateError(cleanupErrors, "MDX cleanup committed but backup cleanup was incomplete");
    }
    return { cleaned: entries.length };
}

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
        if (mode === "cleanup") {
            const plan = createLegacyMigrationPlan(projectRoot);
            const result = validateAlbumMigrationPlan(plan);
            printDiagnostics(result.diagnostics, projectRoot, stderr);
            if (result.diagnostics.length > 0 || result.equivalentCount !== result.albumCount) {
                stderr("Refusing to clean MDX before every manifest is equivalent to its legacy sources");
                return 1;
            }
            const cleaned = cleanupAlbumMdxTransaction(plan).cleaned;
            stdout(`${cleaned} MDX files cleaned after equivalence validation`);
            return 0;
        }
        throw new Error("Usage: node scripts/migrate-album-manifests.mjs <check|write|validate|cleanup>");
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
