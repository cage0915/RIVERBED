import fs from 'node:fs';
import path from 'node:path';
import ExifReader from 'exifreader';

const IMAGES_DIR = path.resolve(process.cwd(), 'public/r2');
const ALBUMS_DIR = path.resolve(process.cwd(), 'src/content/albums');

export async function processAlbum(folderSlug: string, albumSlug: string) {
    const folderPath = path.join(IMAGES_DIR, folderSlug, albumSlug);
    const targetDir = path.join(ALBUMS_DIR, folderSlug);
    const outputPath = path.join(targetDir, `${albumSlug}.mdx`);

    // Skip if MDX already exists
    if (fs.existsSync(outputPath)) {
        console.log(`⏩ Skipping "${folderSlug}/${albumSlug}": MDX already exists.`);
        return { success: false, error: 'MDX already exists' };
    }

    if (!fs.existsSync(folderPath)) {
        console.error(`❌ Error: Folder not found at ${folderPath}`);
        return { success: false, error: 'Source folder not found' };
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
        return { success: false, error: 'No images found' };
    }

    // Read EXIF and sort
    const imageData = await Promise.all(imageFiles.map(async (filename) => {
        const filePath = path.join(folderPath, filename);
        let date: Date | null = null;

        try {
            const buffer = fs.readFileSync(filePath);
            const tags = ExifReader.load(buffer);
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
    const albumTitle = albumSlug.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ');
    const frontmatter = `---
title: "${albumTitle}"
coverKey: "${sortedFiles[0]}"
coverZoom: 1
coverOffset: { x: 50, y: 50 }
---

`;

    // Group photos into rows (1 per row by default like script)
    const photoComponents = sortedFiles.map((filename) => {
        return `<Photo itemKey="${filename}" />`;
    });

    const photosPerRow = 1;
    const rows: string[] = [];
    for (let i = 0; i < photoComponents.length; i += photosPerRow) {
        const rowPhotos = photoComponents.slice(i, i + photosPerRow);
        rows.push(`<Row>\n  ${rowPhotos.join('\n  ')}\n</Row>`);
    }

    const mdxContent = frontmatter + rows.join('\n\n');

    // Ensure directory exists
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    fs.writeFileSync(outputPath, mdxContent, 'utf8');

    // Also update order if possible? 
    // We'll handle order in a separate step via Folder Manager, 
    // but maybe we should append it to the end of _order.json if it exists.
    const orderFile = path.join(targetDir, '_order.json');
    if (fs.existsSync(orderFile)) {
        try {
            const currentOrder = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
            if (Array.isArray(currentOrder) && !currentOrder.includes(albumSlug)) {
                currentOrder.push(albumSlug);
                fs.writeFileSync(orderFile, JSON.stringify(currentOrder, null, 4), 'utf8');
            }
        } catch (e) {
            console.error('Failed to update _order.json:', e);
        }
    }

    console.log(`  ✅ Created album: ${outputPath}`);
    return { success: true, path: outputPath };
}

export function getAvailableFolders(folderSlug: string) {
    const folderPath = path.join(IMAGES_DIR, folderSlug);
    if (!fs.existsSync(folderPath)) return [];

    const albumFolders = fs.readdirSync(folderPath).filter(f => {
        return fs.statSync(path.join(folderPath, f)).isDirectory();
    });

    // Filter out those that already have an MDX file
    const targetDir = path.join(ALBUMS_DIR, folderSlug);
    return albumFolders.filter(slug => {
        const mdxPath = path.join(targetDir, `${slug}.mdx`);
        return !fs.existsSync(mdxPath);
    });
}
