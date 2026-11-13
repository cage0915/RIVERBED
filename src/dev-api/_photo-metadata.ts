import sharp from 'sharp';

export type PhotoMetadata = { width: number; height: number; color: string };

/**
 * Intrinsic size and average colour (#rrggbb) of an imported photo. The colour
 * is the mean of a small sRGB thumbnail, painted behind the photo while it
 * loads. scripts/backfill-album-photo-metadata.mjs reuses averageColor for existing photos.
 */
export async function readPhotoMetadata(bytes: Uint8Array, name: string): Promise<PhotoMetadata> {
    const metadata = await sharp(bytes).metadata();
    if (!metadata.width || !metadata.height) {
        throw new Error(`Unable to read image dimensions: ${name}`);
    }
    return { width: metadata.width, height: metadata.height, color: await averageColor(bytes) };
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
