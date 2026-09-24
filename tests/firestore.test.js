import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, collection, getDocs } from 'firebase/firestore';
let env;
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-koko-security', firestore: { rules: await readFile('firestore.rules', 'utf8') } });
  await env.withSecurityRulesDisabled(async context => {
    for (const [uid, companyId, role] of [['alice', 'acme', 'staff'], ['bob', 'acme', 'staff'], ['mallory', 'other', 'staff'], ['viewer', 'acme', 'viewer']]) {
      await setDoc(doc(context.firestore(), '_access', uid), { active: true, companyId, role });
    }
  });
});
after(async () => env?.cleanup());
const client = (uid, companyId, role = 'staff') => env.authenticatedContext(uid, { companyId, role, kokoAccess: true }).firestore();
test('company colleagues can share records; other companies and guests cannot', async () => {
  for (const path of ['stores/s1', 'stores/s1/chunks/c1', 'invoices/i1', 'quotes/q1', 'tasks/t1']) {
    const target = `companies/acme/${path}`;
    await assertSucceeds(setDoc(doc(client('alice', 'acme'), target), { value: 1 }));
    await assertSucceeds(getDoc(doc(client('bob', 'acme'), target)));
    await assertFails(getDoc(doc(client('mallory', 'other'), target)));
    await assertFails(setDoc(doc(client('mallory', 'other'), target), { value: 2 }));
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), target)));
  }
});
test('viewer reads but cannot write; roles and membership cannot be self-assigned', async () => {
  const viewer = client('viewer', 'acme', 'viewer');
  await assertSucceeds(getDocs(collection(viewer, 'companies/acme/invoices')));
  await assertFails(setDoc(doc(viewer, 'companies/acme/invoices/new'), {}));
  await assertFails(setDoc(doc(viewer, 'companies/acme/members/viewer'), { role: 'owner' }));
  const uninvited = env.authenticatedContext('unknown', { companyId: 'acme', role: 'owner' }).firestore();
  await assertFails(getDocs(collection(uninvited, 'companies/acme/invoices')));
});
test('legacy global collections and usage counters remain private', async () => {
  const db = client('alice', 'acme');
  for (const path of ['stores/old', 'invoices/old', 'quotes/old', 'tasks/old', '_aiUsage/alice', 'users/alice/invoices/old']) {
    await assertFails(getDoc(doc(db, path)));
    await assertFails(setDoc(doc(db, path), {}));
  }
});

test('revocation denies existing tokens immediately', async () => {
  const db = client('revoked', 'acme');
  await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), '_access/revoked'), { active: false, companyId: 'acme', role: 'staff' }));
  await assertFails(getDocs(collection(db, 'companies/acme/invoices')));
});
