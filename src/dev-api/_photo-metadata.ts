import sharp from 'sharp';

export type PhotoMetadata = { width: number; height: number; color: string };

/**
 * Intrinsic size and average colour (#rrggbb) of an imported photo. The colour
 * is the mean of a small sRGB thumbnail, painted behind the photo while it
 * loads. scripts/backfill-album-photo-metadata.mjs reuses averageColor for existing photos.
 */
export async function readPhotoMetadata(bytes: Uint8Array, name: string): Promise<PhotoMetadata> {
    const { width, height } = await orientedSize(bytes);
    if (!width || !height) {
        throw new Error(`Unable to read image dimensions: ${name}`);
    }
    return { width, height, color: await averageColor(bytes) };
}

/**
 * Size as displayed, after EXIF orientation. Browsers rotate photos shot
 * sideways, so the raw stored size would describe a landscape box for a
 * portrait photo and the row would only settle once it loaded.
 */
export async function orientedSize(input: Uint8Array | string): Promise<{ width: number; height: number }> {
    const { autoOrient } = await sharp(input).metadata();
    return { width: autoOrient.width, height: autoOrient.height };
}

export async function averageColor(input: Uint8Array | string): Promise<string> {
    const { data, info } = await sharp(input)
        .resize(64, 64, { fit: 'inside' })
        .toColourspace('srgb')
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    const pixels = info.width * info.height;
    const sums = [0, 0, 0];
    for (let index = 0; index < data.length; index += info.channels) {
        sums[0] += data[index];
        sums[1] += data[index + 1];
        sums[2] += data[index + 2];
    }
    return `#${sums.map((sum) => Math.round(sum / pixels).toString(16).padStart(2, '0')).join('')}`;
}
