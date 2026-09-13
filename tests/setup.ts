// A real Map-backed localStorage. The modules under test read and write it
// directly, and several of the bugs these tests exist to catch are about WHAT
// gets removed — a no-op stub would pass every one of them.
import { beforeEach } from "vitest";

class MemoryStorage implements Storage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

const store = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", { value: store, writable: true });
Object.defineProperty(globalThis, "sessionStorage", { value: new MemoryStorage(), writable: true });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
