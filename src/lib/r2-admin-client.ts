export type R2AdminObject = {
    key: string;
    size: number;
    etag: string;
    uploaded: Date;
    customMetadata?: Record<string, string>;
};

export type R2AdminBody = R2AdminObject & {
    bytes: Uint8Array;
    contentType?: string;
};

export type R2AdminPutOptions = {
    contentType?: string;
    customMetadata?: Record<string, string>;
    etagMatches?: string;
    onlyIfMissing?: boolean;
};

export interface R2AdminClient {
    list(prefix?: string): Promise<R2AdminObject[]>;
    head(key: string): Promise<R2AdminObject | null>;
    get(key: string): Promise<R2AdminBody | null>;
    put(key: string, bytes: Uint8Array, options?: R2AdminPutOptions): Promise<boolean>;
    delete(key: string): Promise<void>;
}

const createS3Client = async (): Promise<R2AdminClient | null> => {
    const accountId = import.meta.env.R2_ACCOUNT_ID?.trim();
    const accessKeyId = import.meta.env.R2_ACCESS_KEY_ID?.trim();
    const secretAccessKey = import.meta.env.R2_SECRET_ACCESS_KEY?.trim();
    const bucketName = import.meta.env.R2_BUCKET?.trim() || 'riverbed-assets';
    if (!accountId || !accessKeyId || !secretAccessKey) return null;

    const {
        DeleteObjectCommand,
        GetObjectCommand,
        HeadObjectCommand,
        ListObjectsV2Command,
        PutObjectCommand,
        S3Client,
    } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
    });
    const cleanEtag = (etag?: string) => etag?.replace(/^"|"$/g, '') || '';
    const isMissing = (error: unknown) => {
        const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
        return value?.name === 'NotFound' || value?.name === 'NoSuchKey' || value?.$metadata?.httpStatusCode === 404;
    };

    return {
        async list(prefix) {
            const objects: R2AdminObject[] = [];
            let continuationToken: string | undefined;
            do {
                const page = await s3.send(new ListObjectsV2Command({
                    Bucket: bucketName,
                    Prefix: prefix,
                    ContinuationToken: continuationToken,
                }));
                objects.push(...(page.Contents || []).flatMap((object) => object.Key ? [{
                    key: object.Key,
                    size: object.Size || 0,
                    etag: cleanEtag(object.ETag),
                    uploaded: object.LastModified || new Date(0),
                }] : []));
                continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
            } while (continuationToken);
            return objects;
        },
        async head(key) {
            try {
                const object = await s3.send(new HeadObjectCommand({ Bucket: bucketName, Key: key }));
                return {
                    key,
                    size: object.ContentLength || 0,
                    etag: cleanEtag(object.ETag),
                    uploaded: object.LastModified || new Date(0),
                    customMetadata: object.Metadata,
                };
            } catch (error) {
                if (isMissing(error)) return null;
                throw error;
            }
        },
        async get(key) {
            try {
                const object = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
                if (!object.Body) return null;
                const bytes = await object.Body.transformToByteArray();
                return {
                    key,
                    size: object.ContentLength || bytes.length,
                    etag: cleanEtag(object.ETag),
                    uploaded: object.LastModified || new Date(0),
                    customMetadata: object.Metadata,
                    contentType: object.ContentType,
                    bytes,
                };
            } catch (error) {
                if (isMissing(error)) return null;
                throw error;
            }
        },
        async put(key, bytes, options = {}) {
            try {
                await s3.send(new PutObjectCommand({
                    Bucket: bucketName,
                    Key: key,
                    Body: bytes,
                    ContentType: options.contentType,
                    Metadata: options.customMetadata,
                    IfMatch: options.etagMatches,
                    IfNoneMatch: options.onlyIfMissing ? '*' : undefined,
                }));
                return true;
            } catch (error) {
                const value = error as { name?: string; $metadata?: { httpStatusCode?: number } };
                if (value?.name === 'PreconditionFailed' || value?.$metadata?.httpStatusCode === 412) return false;
                throw error;
            }
        },
        async delete(key) {
            await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
        },
    };
};

export async function getR2AdminClient(): Promise<R2AdminClient | null> {
    return createS3Client();
}
