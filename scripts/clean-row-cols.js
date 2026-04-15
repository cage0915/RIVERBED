#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Target directory containing MDX files
const ALBUMS_DIR = path.join(__dirname, '../src/content/albums');

function cleanMdxFiles(dir) {
    let updatedCount = 0;

    if (!fs.existsSync(dir)) {
        console.warn(`⚠️ Directory not found: ${dir}`);
        return 0;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            updatedCount += cleanMdxFiles(fullPath);
        } else if (entry.isFile() && fullPath.endsWith('.mdx')) {
            const content = fs.readFileSync(fullPath, 'utf8');

            // Find <Row cols={X}> or <Row cols="X"> and replace with <Row>
            // We use a regex that matches exactly the 'cols' attribute inside the Row tag
            const newContent = content
                .replace(/<Row\s+cols=\{[0-9]+\}\s*>/g, '<Row>')
                .replace(/<Row\s+cols="[0-9]+"\s*>/g, '<Row>');

            if (newContent !== content) {
                fs.writeFileSync(fullPath, newContent, 'utf8');
                console.log(`  ✅ Cleaned: ${path.relative(path.join(__dirname, '..'), fullPath)}`);
                updatedCount++;
            }
        }
    }

    return updatedCount;
}

console.log('🧹 Scanning MDX files to remove "cols" attribute from <Row> ...');
const totalUpdated = cleanMdxFiles(ALBUMS_DIR);
console.log(`\n✨ Done! Updated ${totalUpdated} files.`);
