#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const IMAGES_DIR = path.join(__dirname, '../public/r2');
const ALBUMS_DIR = path.join(__dirname, '../src/content/albums');

// Get command line arguments
const args = process.argv.slice(2);

if (args.length < 3) {
    console.log('Usage: node scripts/new-album.js <folder> <album-slug> <album-title>');
    console.log('Example: node scripts/new-album.js taiwan jade-mountain "玉山主峰"');
    process.exit(1);
}

const [folderSlug, albumSlug, albumTitle] = args;

// Validate folder exists in images
const folderPath = path.join(IMAGES_DIR, folderSlug, albumSlug);
if (!fs.existsSync(folderPath)) {
    console.error(`❌ Error: Folder "${folderSlug}/${albumSlug}" not found in ${IMAGES_DIR}`);
    console.log('Please create the folder and add images first.');
    process.exit(1);
}

// Scan for images
const imageExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.avif'];
const files = fs.readdirSync(folderPath);
const imageFiles = files
    .filter(file => {
        const ext = path.extname(file).toLowerCase();
        return imageExtensions.includes(ext);
    })
    .sort();

if (imageFiles.length === 0) {
    console.error(`❌ Error: No images found in ${folderPath}`);
    process.exit(1);
}

console.log(`📸 Found ${imageFiles.length} images in ${folderSlug}/${albumSlug}/`);

// Generate MDX content
const frontmatter = `---
title: "${albumTitle}"
coverKey: "${folderSlug}/${albumSlug}/${imageFiles[0]}"
order: 0
folder: "${folderSlug}"
---

`;

// Generate Photo components
const photoComponents = imageFiles.map((filename, index) => {
    const key = `${folderSlug}/${albumSlug}/${filename}`;
    return `<Photo itemKey="${key}" caption="" tags={[]} />`;
});

// Group photos into rows (you can customize this logic)
const photosPerRow = 2; // Default to 2 photos per row
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
    console.log('Please choose a different slug or delete the existing file.');
    process.exit(1);
}

// Ensure albums directory exists
if (!fs.existsSync(ALBUMS_DIR)) {
    fs.mkdirSync(ALBUMS_DIR, { recursive: true });
}

fs.writeFileSync(outputPath, mdxContent, 'utf8');

console.log(`✅ Created album: ${outputPath}`);
console.log(`📝 Generated ${rows.length} rows with ${imageFiles.length} photos`);
console.log('\nNext steps:');
console.log('1. Edit the MDX file to adjust row layouts and add captions');
console.log('2. Use the coordinate tool to add mountain tags');
console.log('3. Make sure the folder exists in src/content/folders/');
