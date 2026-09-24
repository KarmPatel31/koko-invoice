import { parentPort, workerData } from 'node:worker_threads';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';
try {
  let pages = 0;
  for (const file of workerData) {
    const buffer = Buffer.from(file.buffer);
    if (file.mimetype === 'application/pdf') {
      if (!buffer.subarray(0, 5).equals(Buffer.from('%PDF-'))) throw new Error();
      const pdf = await PDFDocument.load(buffer);
      pages += pdf.getPageCount();
    } else {
      const meta = await sharp(buffer, { limitInputPixels: 25000000 }).metadata();
      const formats = { 'image/png': 'png', 'image/jpeg': 'jpeg', 'image/webp': 'webp' };
      if (meta.format !== formats[file.mimetype] || !meta.width || !meta.height || meta.width > 10000 || meta.height > 10000 || meta.width * meta.height > 25000000 || (meta.pages || 1) !== 1) throw new Error();
      pages++;
    }
    if (pages > 10) throw new Error();
  }
  parentPort.postMessage(pages > 0);
} catch { parentPort.postMessage(false); }
