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

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 1) {
    console.log('Usage: node scripts/new-album.js <folder>/<album>');
    process.exit(1);
}

const arg = args[0];
const pathParts = arg.split('/');

if (pathParts.length !== 2) {
    console.error(`❌ Error: Invalid format "${arg}". Expected <folder>/<album>`);
    process.exit(1);
}

const [folderSlug, albumSlug] = pathParts;
const albumTitle = "";


// Validate folder exists in images
const folderPath = path.join(IMAGES_DIR, folderSlug, albumSlug);
if (!fs.existsSync(folderPath)) {
    console.error(`❌ Error: Folder "${folderSlug}/${albumSlug}" not found in ${IMAGES_DIR}`);
    process.exit(1);
}

// Scan for images
const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const files = fs.readdirSync(folderPath);
const imageFiles = files
    .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return imageExtensions.includes(ext);
    });

if (imageFiles.length === 0) {
    console.error(`❌ Error: No images found in ${folderPath}`);
    process.exit(1);
}

// Read EXIF and sort
console.log(`🔍 Processing EXIF data for ${imageFiles.length} images...`);

const imageData = await Promise.all(imageFiles.map(async (filename) => {
    const filePath = path.join(folderPath, filename);
    let date = null;

    try {
        const tags = await ExifReader.load(fs.readFileSync(filePath));
        const dateTag = tags['DateTimeOriginal'] || tags['DateTime'] || tags['CreateDate'];

        if (dateTag && dateTag.description) {
            // EXIF format is usually "YYYY:MM:DD HH:MM:SS"
            // JS Date needs "YYYY-MM-DD HH:MM:SS" or similar
            const dateStr = dateTag.description;
            const formattedDate = dateStr.replace(/^(\d{4}):(\d{2}):(\d{2})/, '$1-$2-$3');
            const d = new Date(formattedDate);
            if (!isNaN(d.getTime())) {
                date = d;
            }
        }
    } catch (e) {
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

console.log(`📸 Found ${sortedFiles.length} images in ${folderSlug}/${albumSlug}/`);

// Generate MDX content
const frontmatter = `---
title: "${albumTitle}"
coverKey: "${folderSlug}/${albumSlug}/${sortedFiles[0]}"
order: 0
folder: "${folderSlug}"
---

`;

// Generate Photo components
const photoComponents = sortedFiles.map((filename, index) => {
    const key = `${folderSlug}/${albumSlug}/${filename}`;
    return `<Photo itemKey="${key}" caption="" tags={[]} />`;
});

// Group photos into rows (you can customize this logic)
const photosPerRow = 1; // Default to 1 photo per row
const rows = [];
for (let i = 0; i < photoComponents.length; i += photosPerRow) {
    const rowPhotos = photoComponents.slice(i, i + photosPerRow);
    rows.push(`<Row cols={${rowPhotos.length}}>\n  ${rowPhotos.join('\n  ')}\n</Row>`);
}

const mdxContent = frontmatter + rows.join('\n\n');

// Write MDX file
const outputPath = path.join(ALBUMS_DIR, `${albumSlug}.mdx`);

// Check if file already exists
if (fs.existsSync(outputPath)) {
    console.error(`❌ Error: Album "${albumSlug}.mdx" already exists`);
    process.exit(1);
}

// Ensure albums directory exists
if (!fs.existsSync(ALBUMS_DIR)) {
    fs.mkdirSync(ALBUMS_DIR, { recursive: true });
}

fs.writeFileSync(outputPath, mdxContent, 'utf8');

console.log(`✅ Created album: ${outputPath}`);
console.log(`📝 Generated ${rows.length} rows with ${sortedFiles.length} photos`);
