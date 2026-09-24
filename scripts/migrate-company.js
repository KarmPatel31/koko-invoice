// Explicit document mapping, dry-run by default. Never infer ownership.
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const [mappingFile, flag] = process.argv.slice(2);
if (!mappingFile || !process.env.FIREBASE_PROJECT_ID) throw new Error('Usage: node scripts/migrate-company.js mapping.json [--apply]');
const mapping = JSON.parse(await readFile(mappingFile, 'utf8'));
initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
const db = getFirestore();
const copies = [];
const sources = new Set();
for (const item of mapping) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(item.companyId) || !/^(stores|invoices|quotes|tasks)\/[^/]+$/.test(item.source) || sources.has(item.source)) throw new Error('Invalid or duplicate ownership mapping');
  sources.add(item.source);
  const source = await db.doc(item.source).get();
  if (!source.exists) throw new Error(`Missing source ${item.source}`);
  copies.push({ target: `companies/${item.companyId}/${item.source}`, data: source.data() });
  if (item.source.startsWith('stores/')) {
    const chunks = await source.ref.collection('chunks').get();
    for (const chunk of chunks.docs) copies.push({ target: `companies/${item.companyId}/${item.source}/chunks/${chunk.id}`, data: chunk.data() });
  }
}
for (const item of copies) {
  if ((await db.doc(item.target).get()).exists) throw new Error(`Destination already exists: ${item.target}`);
}
console.log(`Validated ${copies.length} documents; ${flag === '--apply' ? 'applying' : 'dry run only'}.`);
if (flag === '--apply') {
  // create() prevents accidental overwrites. Legacy records are retained for rollback.
  for (let i = 0; i < copies.length; i += 400) {
    const batch = db.batch();
    for (const item of copies.slice(i, i + 400)) batch.create(db.doc(item.target), item.data);
    await batch.commit();
  }
  console.log('Migration completed. Verify counts and records before opening customer access.');
}
