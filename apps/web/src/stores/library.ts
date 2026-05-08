import { create } from "zustand";
import { api, type BulkOp, type ComicSummary, type UploadComicsResult } from "../lib/api";

export interface UploadProgress {
  /** "uploading" while bytes are streaming, "processing" once they
   *  are all on the server but the response hasn't arrived yet. */
  phase: "uploading" | "processing";
  loaded: number;
  total: number;
  fileCount: number;
}

interface LibraryState {
  comics: ComicSummary[];
  loading: boolean;
  uploading: boolean;
  uploadProgress: UploadProgress | null;
  query: string;
  filter: "all" | "favorites" | "in-progress" | "completed";
  load: () => Promise<void>;
  scan: () => Promise<{ added: number; removed: number; total: number }>;
  upload: (files: File[]) => Promise<UploadComicsResult>;
  setQuery: (q: string) => void;
  setFilter: (f: LibraryState["filter"]) => void;
  toggleFavorite: (id: string) => Promise<void>;
  bulk: (
    ids: string[],
    op: BulkOp,
    category?: string | null,
  ) => Promise<{ affected: number }>;
}

export const useLibraryStore = create<LibraryState>((set, get) => ({
  comics: [],
  loading: false,
  uploading: false,
  uploadProgress: null,
  query: "",
  filter: "all",
  async load() {
    set({ loading: true });
    try {
      const comics = await api.library();
      set({ comics });
    } catch {
      // silently fail — keep previous comics in memory
    } finally {
      set({ loading: false });
    }
  },
  async scan() {
    try {
      const result = await api.scan();
      await get().load();
      return result;
    } catch {
      await get().load();
      throw new Error("No se pudo escanear la biblioteca");
    }
  },
  async upload(files) {
    set({
      uploading: true,
      uploadProgress: { phase: "uploading", loaded: 0, total: 0, fileCount: files.length },
    });
    try {
      const result = await api.uploadComicsWithProgress(files, {
        onProgress: (loaded, total) => {
          set({ uploadProgress: { phase: "uploading", loaded, total, fileCount: files.length } });
        },
        onUploadComplete: () => {
          // Bytes are all uploaded; the server is now extracting and
          // registering. Switch to the indeterminate "processing" phase.
          const cur = get().uploadProgress;
          set({
            uploadProgress: {
              phase: "processing",
              loaded: cur?.loaded ?? 0,
              total: cur?.total ?? 0,
              fileCount: files.length,
            },
          });
        },
      });
      await get().load();
      return result;
    } finally {
      set({ uploading: false, uploadProgress: null });
    }
  },
  setQuery(query) {
    set({ query });
  },
  setFilter(filter) {
    set({ filter });
  },
  async toggleFavorite(id) {
    const comic = get().comics.find((c) => c.id === id);
    if (!comic) return;
    const next = !comic.isFavorite;
    set({ comics: get().comics.map((c) => (c.id === id ? { ...c, isFavorite: next } : c)) });
    await api.setFavorite(id, next);
  },
  async bulk(ids, op, category) {
    const r = await api.bulk(ids, op, category);
    // Refresh from the server so completed/currentPage/category etc. all
    // come back consistent with whatever updateMany / cascade did.
    await get().load();
    return { affected: r.affected };
  },
}));
