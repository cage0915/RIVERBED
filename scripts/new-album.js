#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExifReader from 'exifreader';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const IMAGES_DIR = path.join(__dirname, '../public/r2');
const ALBUMS_DIR = path.join(__dirname, '../src/content/albums');

async function processAlbum(folderSlug, albumSlug) {
    const folderPath = path.join(IMAGES_DIR, folderSlug, albumSlug);
    const targetDir = path.join(ALBUMS_DIR, folderSlug);
    const outputPath = path.join(targetDir, `${albumSlug}.mdx`);

    // Skip if MDX already exists
    if (fs.existsSync(outputPath)) {
        console.log(`⏩ Skipping "${folderSlug}/${albumSlug}": MDX already exists.`);
        return;
    }

    console.log(`🆕 Processing new album: "${folderSlug}/${albumSlug}"`);

    // Scan for images
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
    const files = fs.readdirSync(folderPath);
    const imageFiles = files
        .filter(file => {
            const ext = path.extname(file).toLowerCase();
            return imageExtensions.includes(ext);
        });

    if (imageFiles.length === 0) {
        console.warn(`⚠️ Warning: No images found in ${folderPath}. Skipping.`);
        return;
    }

    // Read EXIF and sort
    console.log(`  🔍 Processing EXIF data for ${imageFiles.length} images...`);

    const imageData = await Promise.all(imageFiles.map(async (filename) => {
        const filePath = path.join(folderPath, filename);
        let date = null;

        try {
            const tags = await ExifReader.load(fs.readFileSync(filePath));
            const dateTag = tags['DateTimeOriginal'] || tags['DateTime'] || tags['CreateDate'];

            if (dateTag && dateTag.description) {
                const dateStr = dateTag.description;
                const formattedDate = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
                const d = new Date(formattedDate);
                if (!isNaN(d.getTime())) {
                    date = d;
                }
            }
        } catch (e) {
            // Ignore EXIF errors
        }

        return { filename, date };
    }));

    // Sort: date (old to new), then filename
    imageData.sort((a, b) => {
        if (a.date && b.date) {
            return a.date.getTime() - b.date.getTime();
        }
        if (a.date && !b.date) return -1;
        if (!a.date && b.date) return 1;

        return a.filename.localeCompare(b.filename, undefined, { numeric: true, sensitivity: 'base' });
    });

    const sortedFiles = imageData.map(d => d.filename);

    // Generate MDX content
    const albumTitle = "";
    const frontmatter = `---
title: "${albumTitle}"
coverKey: "${folderSlug}/${albumSlug}/${sortedFiles[0]}"
order: 0
---

`;

    // Generate Photo components
    const photoComponents = sortedFiles.map((filename) => {
        const key = `${folderSlug}/${albumSlug}/${filename}`;
        return `<Photo itemKey="${key}" caption="" tags={[]} />`;
    });

    // Group photos into rows
    const photosPerRow = 1;
    const rows = [];
    for (let i = 0; i < photoComponents.length; i += photosPerRow) {
        const rowPhotos = photoComponents.slice(i, i + photosPerRow);
        rows.push(`<Row cols={${rowPhotos.length}}>\n  ${rowPhotos.join('\n  ')}\n</Row>`);
    }

    const mdxContent = frontmatter + rows.join('\n\n');

    // Ensure directory exists
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, mdxContent, 'utf8');

    console.log(`  ✅ Created album: ${outputPath}`);
    console.log(`  📝 Generated ${rows.length} rows with ${sortedFiles.length} photos`);
}

async function main() {
    if (!fs.existsSync(IMAGES_DIR)) {
        console.error(`❌ Error: IMAGES_DIR not found at ${IMAGES_DIR}`);
        process.exit(1);
    }

    const folders = fs.readdirSync(IMAGES_DIR).filter(f => {
        return fs.statSync(path.join(IMAGES_DIR, f)).isDirectory();
    });

    for (const folderSlug of folders) {
        const albumFolders = fs.readdirSync(path.join(IMAGES_DIR, folderSlug)).filter(f => {
            return fs.statSync(path.join(IMAGES_DIR, folderSlug, f)).isDirectory();
        });

        for (const albumSlug of albumFolders) {
            await processAlbum(folderSlug, albumSlug);
        }
    }
}

main().catch(err => {
    console.error('❌ Critical Error:', err);
    process.exit(1);
});
