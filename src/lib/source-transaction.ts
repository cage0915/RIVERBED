import { randomUUID } from "node:crypto";
import {
    rename as renameFile,
    unlink as unlinkFile,
    writeFile as writeSourceFile,
} from "node:fs/promises";
import path from "node:path";

export type TextFileProposal = {
    target: string;
    contents: string;
};

export type TextFileOperations = {
    writeFile: (
        target: string,
        contents: string,
        encoding: "utf8",
    ) => Promise<void>;
    rename: (source: string, target: string) => Promise<void>;
    unlink: (target: string) => Promise<void>;
};

const defaultOperations: TextFileOperations = {
    writeFile: (target, contents, encoding) =>
        writeSourceFile(target, contents, encoding),
    rename: renameFile,
    unlink: unlinkFile,
};

let transactionQueue: Promise<void> = Promise.resolve();

function isMissingFile(error: unknown): boolean {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function removeIfPresent(
    target: string,
    operations: TextFileOperations,
): Promise<void> {
    try {
        await operations.unlink(target);
    } catch (error) {
        if (!isMissingFile(error)) throw error;
    }
}

async function commitWithinLock(
    proposals: readonly TextFileProposal[],
    operations: TextFileOperations,
): Promise<void> {
    const targets = new Set<string>();
    for (const proposal of proposals) {
        if (targets.has(proposal.target)) {
            throw new Error(`Duplicate source transaction target: ${proposal.target}`);
        }
        targets.add(proposal.target);
    }

    const token = `${process.pid}-${randomUUID()}`;
    const entries = proposals.map((proposal) => {
        const directory = path.dirname(proposal.target);
        const basename = path.basename(proposal.target);
        return {
            ...proposal,
            temporary: path.join(directory, `.${basename}.${token}.tmp`),
            backup: path.join(directory, `.${basename}.${token}.bak`),
            backedUp: false,
            replaced: false,
        };
    });

    try {
        for (const entry of entries) {
            await operations.writeFile(
                entry.temporary,
                entry.contents,
                "utf8",
            );
        }
        for (const entry of entries) {
            await operations.rename(entry.target, entry.backup);
            entry.backedUp = true;
            await operations.rename(entry.temporary, entry.target);
            entry.replaced = true;
        }
    } catch (error) {
        const rollbackErrors: unknown[] = [];
        for (const entry of [...entries].reverse()) {
            if (entry.replaced) {
                await removeIfPresent(entry.target, operations).catch((failure) =>
                    rollbackErrors.push(failure),
                );
            }
            if (entry.backedUp) {
                await operations.rename(entry.backup, entry.target).catch((failure) =>
                    rollbackErrors.push(failure),
                );
            }
            await removeIfPresent(entry.temporary, operations).catch((failure) =>
                rollbackErrors.push(failure),
            );
        }
        if (rollbackErrors.length > 0) {
            throw new AggregateError(
                [error, ...rollbackErrors],
                "Source transaction failed and rollback was incomplete",
            );
        }
        throw error;
    }

    const cleanupErrors: unknown[] = [];
    for (const entry of entries) {
        await removeIfPresent(entry.backup, operations).catch((failure) =>
            cleanupErrors.push(failure),
        );
    }
    if (cleanupErrors.length > 0) {
        throw new AggregateError(
            cleanupErrors,
            "Source transaction committed but backup cleanup was incomplete",
        );
    }
}

export async function commitTextFiles(
    proposals: readonly TextFileProposal[],
    operations: TextFileOperations = defaultOperations,
): Promise<void> {
    if (proposals.length === 0) return;

    const previous = transactionQueue;
    let release: () => void = () => undefined;
    transactionQueue = new Promise<void>((resolve) => {
        release = resolve;
    });

    await previous;
    try {
        await commitWithinLock(proposals, operations);
    } finally {
        release();
    }
}
