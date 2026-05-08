import fs from "node:fs/promises";
import { getOrCreateInstance, withFileLock } from "../extractor-instance-cache";
import type { Extractor, PageRef } from "./types";

// pdfjs-dist legacy build runs in plain Node.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs: any = require("pdfjs-dist/legacy/build/pdf.js");

let createCanvas: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const canvas = require("@napi-rs/canvas");
  createCanvas = canvas.createCanvas;
} catch {
  console.warn("[pdf] canvas not available, PDF rendering may be limited");
}

type PdfInstance = {
  doc: any;
  numPages: number;
  dispose: () => void;
};

async function loadPdfInstance(filePath: string): Promise<PdfInstance> {
  const data = await fs.readFile(filePath);
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(data),
    disableFontFace: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });
  const doc = await loadingTask.promise;
  return {
    doc,
    numPages: doc.numPages,
    dispose: () => {
      try {
        doc.destroy?.();
      } catch {
        // ignore
      }
    },
  };
}

async function getInstance(filePath: string): Promise<PdfInstance> {
  return getOrCreateInstance("pdf", filePath, () => loadPdfInstance(filePath));
}

export const pdfExtractor: Extractor = {
  async count(filePath) {
    try {
      const instance = await getInstance(filePath);
      return instance.numPages;
    } catch (err) {
      console.error(`[pdf] count failed for ${filePath}:`, err);
      return 0;
    }
  },
  async list(filePath): Promise<PageRef[]> {
    try {
      const instance = await getInstance(filePath);
      const refs: PageRef[] = [];
      for (let i = 0; i < instance.numPages; i++) refs.push({ index: i, name: `page-${i + 1}.png` });
      return refs;
    } catch (err) {
      console.error(`[pdf] list failed for ${filePath}:`, err);
      return [];
    }
  },
  async page(filePath, index) {
    if (!createCanvas) {
      throw new Error("Canvas not available - cannot render PDF");
    }
    try {
      const instance = await getInstance(filePath);
      // pdfjs is not safe under concurrent renders against the same doc.
      return await withFileLock(filePath, async () => {
        const page = await instance.doc.getPage(index + 1);
        try {
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
          const ctx = canvas.getContext("2d");
          await page.render({ canvasContext: ctx as any, viewport }).promise;
          return canvas.toBuffer("image/png");
        } finally {
          try {
            page.cleanup?.();
          } catch {
            // ignore
          }
        }
      });
    } catch (err) {
      console.error(`[pdf] page ${index} failed for ${filePath}:`, err);
      throw err;
    }
  },
};
