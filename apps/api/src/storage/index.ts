import type { Config } from "../config";
import { LocalDiskStorage } from "./local";
import { S3Storage } from "./s3";

export interface Storage {
  put(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;
  /**
   * Deletes stored objects by their public URL. Best effort and idempotent: URLs that are not this storage's
   * (or no longer exist) are skipped silently.
   */
  remove(urls: string[]): Promise<void>;
}

export function createStorage(config: Config): Storage {
  if (config.storage.driver === "s3") return new S3Storage(config.storage.s3);
  return new LocalDiskStorage(config.storage.uploadDir, config.publicBaseUrl);
}
