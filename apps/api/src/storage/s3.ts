import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Storage } from "./index";

export interface S3Options {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string;
}

/** Any S3-compatible store (AWS, R2, MinIO, ...). Objects are expected to be publicly readable via `publicUrl`. */
export class S3Storage implements Storage {
  private readonly client: S3Client;
  constructor(private readonly opts: S3Options) {
    this.client = new S3Client({
      region: opts.region,
      ...(opts.endpoint ? { endpoint: opts.endpoint, forcePathStyle: true } : {}),
      credentials: { accessKeyId: opts.accessKeyId, secretAccessKey: opts.secretAccessKey },
    });
  }

  async put(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.opts.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    );
    return { url: `${this.opts.publicUrl}/${key}` };
  }
}
