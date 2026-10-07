import { mkdir, writeFile } from "node:fs/promises";
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
}
