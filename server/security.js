import { Worker } from 'node:worker_threads';

export const MAX_UPLOAD = 20 * 1024 * 1024;
export const MAX_REQUEST = MAX_UPLOAD + 64 * 1024;
export const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'];

export function validateFiles(files) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./validate-upload.js', import.meta.url), {
      workerData: files.map(({ buffer, mimetype }) => ({ buffer, mimetype })),
      resourceLimits: { maxOldGenerationSizeMb: 128 }
    });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Invalid upload')); }, 5000);
    worker.once('message', valid => {
      clearTimeout(timer); worker.terminate();
      valid ? resolve() : reject(new Error('Invalid upload'));
    });
    worker.once('error', () => { clearTimeout(timer); reject(new Error('Invalid upload')); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Invalid upload')); });
  });
}

// Atomic, shared across server instances; clients cannot access this collection.
export function createQuotaConsumer(db) {
  return async (uid, companyId = uid) => {
    const ref = db.collection('_aiUsage').doc(uid);
    const companyRef = db.collection('_aiCompanyUsage').doc(companyId);
    const now = Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const minute = Math.floor(now / 60000);
    return db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const companySnapshot = await transaction.get(companyRef);
      const companyOld = companySnapshot.data() || {};
      const companyDaily = companyOld.day === day ? companyOld.dailyCount : 0;
      const old = snapshot.data() || {};
      const dailyCount = old.day === day ? old.dailyCount : 0;
      const minuteCount = old.minute === minute ? old.minuteCount : 0;
      if (dailyCount >= 100 || minuteCount >= 10 || companyDaily >= 500) return false;
      transaction.set(ref, { day, minute, dailyCount: dailyCount + 1, minuteCount: minuteCount + 1 });
      transaction.set(companyRef, { day, dailyCount: companyDaily + 1 });
      return true;
    });
  };
}
