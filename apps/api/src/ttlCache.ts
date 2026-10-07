/** Small cache bounded in both age and size (oldest entry is evicted first). */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(private readonly opts: { maxEntries: number; ttlMs: number; now?: () => number }) {}

  private now(): number {
    return this.opts.now?.() ?? Date.now();
  }

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key); // re-insert so the key counts as the newest
    this.entries.set(key, { value, expiresAt: this.now() + this.opts.ttlMs });
    while (this.entries.size > this.opts.maxEntries) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
