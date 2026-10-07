import type { Config } from "../config";
import { LocalDiskStorage } from "./local";
import { S3Storage } from "./s3";

export interface Storage {
  put(key: string, buffer: Buffer, contentType: string): Promise<{ url: string }>;
}

export function createStorage(config: Config): Storage {
  if (config.storage.driver === "s3") return new S3Storage(config.storage.s3);
  return new LocalDiskStorage(config.storage.uploadDir, config.publicBaseUrl);
}
