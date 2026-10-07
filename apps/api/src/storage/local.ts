import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Storage } from "./index";

export class LocalDiskStorage implements Storage {
  readonly root: string;
  constructor(
    uploadDir: string,
    private readonly publicBaseUrl: string,
  ) {
    this.root = resolve(uploadDir);
  }

  async put(key: string, buffer: Buffer, _contentType: string): Promise<{ url: string }> {
    const target = resolve(this.root, key);
    if (!target.startsWith(this.root + sep)) throw new Error("invalid storage key");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, buffer);
    return { url: `${this.publicBaseUrl}/uploads/${key}` };
  }

  async remove(urls: string[]): Promise<void> {
    const prefix = `${this.publicBaseUrl}/uploads/`;
    for (const url of urls) {
      if (!url.startsWith(prefix)) continue;
      const target = resolve(this.root, url.slice(prefix.length));
      if (!target.startsWith(this.root + sep)) continue; // never leave the upload directory
      await rm(target, { force: true });
    }
  }
}
