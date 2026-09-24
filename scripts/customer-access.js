// Run only from a trusted admin environment. Never shipped to the browser.
import 'dotenv/config';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const [uid, action, companyId, role] = process.argv.slice(2);
if ((action === 'grant' && (!/^[a-zA-Z0-9_-]{1,128}$/.test(companyId || '') || !['owner', 'admin', 'staff', 'viewer'].includes(role))) || !uid || !['grant', 'revoke'].includes(action) || !process.env.FIREBASE_PROJECT_ID) {
  throw new Error('Usage: node scripts/customer-access.js FIREBASE_UID grant COMPANY_ID owner|admin|staff|viewer (or FIREBASE_UID revoke); set FIREBASE_PROJECT_ID');
}
initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID });
const auth = getAuth();
const user = await auth.getUser(uid);
await getFirestore().collection('_access').doc(uid).set({ active: action === 'grant', companyId: companyId || user.customClaims?.companyId || '', role: role || user.customClaims?.role || '' });
await auth.setCustomUserClaims(uid, { ...user.customClaims, kokoAccess: action === 'grant', ...(action === 'grant' ? { companyId, role } : {}) });
await auth.revokeRefreshTokens(uid);
console.log(`Workspace access ${action === 'grant' ? 'granted' : 'revoked'}. User must sign in again.`);
