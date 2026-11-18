import sharp from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';

export type PhotoMetadata = { width: number; height: number; color: string; thumbhash: string };

/**
 * Intrinsic size, average colour (#rrggbb) and ThumbHash of an imported photo.
 * The colour is the mean of a small sRGB thumbnail and the ThumbHash a blurred
 * preview of it, both painted behind the photo while it loads.
 * scripts/backfill-album-photo-metadata.mjs reuses these for existing photos.
 */
export async function readPhotoMetadata(bytes: Uint8Array, name: string): Promise<PhotoMetadata> {
    const { width, height } = await orientedSize(bytes);
    if (!width || !height) {
        throw new Error(`Unable to read image dimensions: ${name}`);
    }
    const [color, thumbhash] = await Promise.all([averageColor(bytes), photoThumbHash(bytes)]);
    return { width, height, color, thumbhash };
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

/**
 * Base64 ThumbHash of the photo as displayed (EXIF-oriented). ThumbHash takes
 * at most 100×100 pixels.
 */
export async function photoThumbHash(input: Uint8Array | string): Promise<string> {
    const { data, info } = await sharp(input)
        .autoOrient()
        .resize(100, 100, { fit: 'inside' })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
    return Buffer.from(rgbaToThumbHash(info.width, info.height, data)).toString('base64');
}
