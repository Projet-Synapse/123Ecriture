// Faux système de fichiers File System Access API en mémoire — utilisé par
// les tests des ponts web (webFs.test.ts, webVaultAdapter.test.ts). Mêmes
// sémantiques que la vraie API : getFileHandle/getDirectoryHandle lèvent si
// absent (sauf {create:true}), removeEntry récursif, itération des enfants.

import type { FsaDirectoryHandleLike, FsaFileHandleLike } from './webFs';

type Entry = { type: 'file'; content: string; lastModified: number } | { type: 'dir' };

export class FakeFs {
  private entries = new Map<string, Entry>();

  pathOf(...segments: string[]): string {
    return segments.filter((segment) => segment !== '').join('/');
  }

  addFile(path: string, content: string, lastModified = 1000): void {
    this.entries.set(path, { type: 'file', content, lastModified });
  }

  addDir(path: string): void {
    if (path === '') return;
    this.entries.set(path, { type: 'dir' });
  }

  contentOf(path: string): string {
    const entry = this.entries.get(path);
    if (!entry || entry.type !== 'file') throw new Error(`Fichier absent : ${path}`);
    return entry.content;
  }

  has(path: string): boolean {
    return this.entries.has(path);
  }

  removeTree(path: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.entries.delete(key);
    }
  }

  root(name = 'coffre-test'): FsaDirectoryHandleLike {
    return new FakeDirHandle(this, '', name);
  }
}

class FakeDirHandle implements FsaDirectoryHandleLike {
  kind = 'directory' as const;

  constructor(
    private readonly fs: FakeFs,
    private readonly path: string,
    private readonly dirName: string,
  ) {}

  get name(): string {
    return this.dirName;
  }

  async getFileHandle(name: string, options?: { create?: boolean }): Promise<FsaFileHandleLike> {
    const childPath = this.fs.pathOf(this.path, name);
    const entry = this.fs['entries'].get(childPath);
    if (entry?.type === 'file') return new FakeFileHandle(this.fs, childPath, name);
    if (options?.create && !entry) {
      this.fs.addFile(childPath, '');
      return new FakeFileHandle(this.fs, childPath, name);
    }
    throw new Error(`TypeMismatch ou NotFound : ${childPath}`);
  }

  async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FsaDirectoryHandleLike> {
    const childPath = this.fs.pathOf(this.path, name);
    const entry = this.fs['entries'].get(childPath);
    if (entry?.type === 'dir') return new FakeDirHandle(this.fs, childPath, name);
    if (options?.create && !entry) {
      this.fs.addDir(childPath);
      return new FakeDirHandle(this.fs, childPath, name);
    }
    throw new Error(`TypeMismatch ou NotFound : ${childPath}`);
  }

  async removeEntry(name: string): Promise<void> {
    const childPath = this.fs.pathOf(this.path, name);
    if (!this.fs.has(childPath)) throw new Error(`NotFound : ${childPath}`);
    this.fs.removeTree(childPath);
  }

  async *values(): AsyncIterableIterator<FsaFileHandleLike | FsaDirectoryHandleLike> {
    for (const [path, entry] of this.fs['entries']) {
      const directChild = this.path === '' ? !path.includes('/') : path.startsWith(`${this.path}/`) && !path.slice(this.path.length + 1).includes('/');
      if (!directChild) continue;
      const name = path.split('/').pop() as string;
      if (entry.type === 'file') yield new FakeFileHandle(this.fs, path, name);
      else yield new FakeDirHandle(this.fs, path, name);
    }
  }
}

class FakeFileHandle implements FsaFileHandleLike {
  kind = 'file' as const;

  constructor(
    private readonly fs: FakeFs,
    private readonly path: string,
    private readonly fileName: string,
  ) {}

  get name(): string {
    return this.fileName;
  }

  async getFile(): Promise<File> {
    const entry = this.fs['entries'].get(this.path);
    if (!entry || entry.type !== 'file') throw new Error(`Fichier absent : ${this.path}`);
    return {
      name: this.fileName,
      lastModified: entry.lastModified,
      size: entry.content.length,
      text: async () => entry.content,
      arrayBuffer: async () => new TextEncoder().encode(entry.content).buffer,
    } as unknown as File;
  }

  async createWritable(): Promise<{
    write(data: string | BufferSource | Blob): Promise<void>;
    close(): Promise<void>;
  }> {
    let pending = '';
    return {
      write: async (data) => {
        // Fichier binaire (copie de pièce jointe/déplacement) : le pont écrit
        // un File/Blob, on extrait le texte comme le vrai navigateur.
        pending = typeof data === 'string' ? data : await (data as Blob).text();
      },
      close: async () => {
        this.fs.addFile(this.path, pending);
      },
    };
  }
}
