# Koko Invoice

Invite-only invoice management for shared company workspaces. React/Vite frontend, Firebase Authentication and Firestore, and a separate Express/Gemini API.

## Local setup

Requires Node 22+ (Java 21+ for Firestore rule tests).

```sh
npm ci
npm run dev
```

Create a local, git-ignored `.env` with:

```dotenv
FIREBASE_PROJECT_ID=your-firebase-project
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/server-only-service-account.json
GEMINI_API_KEY=your-server-only-key
GEMINI_MODEL=gemini-3.5-flash
PORT=8787
ALLOWED_ORIGINS=https://koko-invoice.web.app,https://koko-invoice.firebaseapp.com
```

Use workload identity/Application Default Credentials in production rather than downloaded keys. Never use a `VITE_` prefix for server secrets. The server refuses to start without its project ID and Gemini key.

The frontend accepts `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, and `VITE_FIREBASE_APP_ID`. These are public Firebase project identifiers; authorization is enforced through rules and verified sessions. Configure them together for your production project.

In development Vite proxies `/api` to port 8787. In production set `VITE_API_BASE_URL=https://your-api.example` **before building**, or configure your hosting reverse proxy to forward `/api/*` to the API. Firebase Hosting alone does not run the API; its current rewrite serves the frontend only.

## Accounts and roles

Enable Firebase Email/Password sign-in and configure authorized domains and password reset emails. Create invited users in the Firebase console. There is no public registration UI. An account without server-granted workspace access cannot read records or run AI scans.

Grant access from a trusted operator environment:

```sh
node scripts/customer-access.js FIREBASE_UID grant COMPANY_ID owner
node scripts/customer-access.js STAFF_UID grant COMPANY_ID staff
node scripts/customer-access.js VIEWER_UID grant COMPANY_ID viewer
node scripts/customer-access.js FIREBASE_UID revoke
```

Company IDs use letters, digits, underscores and hyphens, up to 128 characters. Each account belongs to one company. Owner, admin and staff can edit business records; viewers can only read and cannot run paid scans. Account provisioning and role changes are operator-managed, not self-service. Only trusted operators with Firebase Admin credentials can grant roles. Sign in again after changing claims. Revocation disables the server-managed access record immediately. Both Firestore rules and the API check that record, so an already-issued token cannot retain workspace access. Role or company changes also invalidate the old access context.

Records live under `companies/{companyId}/{stores|invoices|quotes|tasks}`. Price-book chunks inherit the same company boundary. The demo uses only in-memory sample data and does not persist business records or get access to the API. Legacy browser login, Gemini keys, and business-data caches are removed on startup; export any browser-only data before upgrading.

## AI limits

- Revocation-checked Firebase ID token and invited company role required.
- 30 requests/minute/IP per server process; spoofed forwarded IP headers are not trusted.
- Durable, transactional limits of 10 attempts/minute and 100 attempts/day per user, plus 500 attempts/day per company, shared across instances. Failed attempts count toward limits.
- At most four in-flight requests per server, one per user on that server.
- Up to five files, 20 MB combined file content, bounded multipart overhead, ten total PDF/image pages.
- PDF parsing and image metadata validation run in a worker with a five-second deadline. Images are limited to 25 megapixels, 10,000 pixels per side, and a single frame.
- Upload deadline 30 seconds; Gemini deadline 60 seconds and bounded output.
- Production Gemini credentials stay on the server; client-supplied keys are not supported.

At larger scale place a shared IP rate limiter/WAF and request-size limit in front of the service. Keep instance counts bounded and set provider quotas/budget alerts; request limits bound attempts rather than guaranteeing a specific dollar spend. Restrict direct API ingress to your trusted gateway if configuring forwarded IP trust.

## Tests and release

```sh
npm test
npm run test:rules
npm run build
# With the local frontend running and Chrome installed:
npm run test:pdf
npm audit --omit=dev
```

See [release instructions](docs/RELEASE.md) for migration and rollout. `npm run deploy` deploys frontend and rules, **not the API**. Do not deploy only hosting and leave legacy permissive rules in place.
