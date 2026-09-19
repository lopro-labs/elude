declare module 'rbush' {
  export interface BBoxItem {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }
  export default class RBush<T extends BBoxItem = BBoxItem> {
    constructor(maxEntries?: number);
    insert(item: T): this;
    load(items: readonly T[]): this;
    remove(item: T, equals?: (a: T, b: T) => boolean): this;
    clear(): this;
    search(bbox: BBoxItem): T[];
    all(): T[];
    collides(bbox: BBoxItem): boolean;
    toJSON(): unknown;
    fromJSON(data: unknown): this;
  }
}
