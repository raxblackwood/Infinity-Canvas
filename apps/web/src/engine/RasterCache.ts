/**
 * Client-side LRU cache for pyramid raster tiles (/raster/{k}/{x}/{y}.webp).
 */
export class RasterTileCache {
  private cache: Map<string, HTMLImageElement | null> = new Map(); // key -> image (or null if 404)
  private pending: Set<string> = new Set();
  private maxEntries = 256;
  private onTileLoaded?: () => void;

  constructor(options: { maxEntries?: number; onTileLoaded?: () => void } = {}) {
    if (options.maxEntries) this.maxEntries = options.maxEntries;
    this.onTileLoaded = options.onTileLoaded;
  }

  get(level: number, x: number, y: number, version = 1): HTMLImageElement | null | undefined {
    const key = `${level}_${x}_${y}`;
    if (this.cache.has(key)) {
      // Move to back (MRU)
      const val = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, val);
      return val;
    }

    if (!this.pending.has(key)) {
      this.fetchTile(level, x, y, version, key);
    }

    return undefined; // Not yet loaded
  }

  private fetchTile(level: number, x: number, y: number, version: number, key: string): void {
    this.pending.add(key);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = `/raster/${level}/${x}/${y}.webp?v=${version}`;

    img.onload = () => {
      this.pending.delete(key);
      this.put(key, img);
      this.onTileLoaded?.();
    };

    img.onerror = () => {
      this.pending.delete(key);
      // 404 or missing tile represents blank paper
      this.put(key, null);
      this.onTileLoaded?.();
    };
  }

  private put(key: string, img: HTMLImageElement | null): void {
    if (this.cache.size >= this.maxEntries) {
      // Evict oldest (first key in Map)
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(key, img);
  }

  clear(): void {
    this.cache.clear();
    this.pending.clear();
  }
}
