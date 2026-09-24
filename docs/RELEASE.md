# Customer release procedure

## Configuration and staging

1. Use a staging Firebase project and separate Gemini credentials. Enable Email/Password authentication, email enumeration protection, a password policy, and authorized domains. Prepare invited customer accounts and workspace roles.
2. Deploy the API using the Dockerfile on a managed HTTPS service with workload identity, a least-privilege service account, secrets manager, bounded scaling, and a memory limit of at least 1 GB. Set its Firebase project, allowed frontend origins, and Gemini secret. Configure an upstream 21 MB body limit and request timeout at least 75 seconds. Keep the default untrusted proxy setting unless the gateway topology has been explicitly secured.
3. Set `VITE_API_BASE_URL` to that service URL before building the frontend. Never put secrets into frontend build variables. Rotate any Gemini keys previously used in the browser.
4. Run API tests, Firestore emulator isolation tests, build, dependency audit, then real staging sign-in/password reset, account switching, viewer denial, and one authenticated invoice scan. Automated API tests mock Firebase token verification and Gemini; they do not prove live credentials or provider availability.
5. Verify one company cannot list/read/write another company's invoices, stores and chunks. Verify uninvited accounts and viewers cannot invoke AI. Confirm sign-out clears visible business data.

## Existing data migration

Back up Firestore and export browser-only records before rollout. Schedule a maintenance window to prevent concurrent legacy writes. Do not assign all shared documents to the first user who signs in.

Create a reviewed JSON mapping from each legacy document to its rightful company:

```json
[
  { "source": "stores/STORE_ID", "companyId": "company-a" },
  { "source": "invoices/INVOICE_ID", "companyId": "company-a" }
]
```

Run `node scripts/migrate-company.js mapping.json` for a dry run. Review ownership and counts, then run with `--apply`. The script copies store chunks, refuses existing destinations, and retains legacy source documents. If interrupted, review copied destinations and prepare a remaining-only mapping before retrying. Verify invoice store IDs resolve inside the same company. This tool intentionally does not guess relationships or delete legacy records.

Deploy the new rules, API, and frontend together during maintenance. The new rules deny legacy top-level collections. Keep the backup and legacy data inaccessible until retention requirements allow cleanup. Roll back application releases without restoring permissive global rules.

## Operations before onboarding

- Configure uptime/error monitoring and alerts on repeated 5xx responses, quota denials, memory pressure, and AI spend. Health only reports process liveness.
- Enable Firestore backups/PITR and perform a restore exercise. Define an owner for incident response and access revocation.
- Establish support, customer privacy terms, invoice retention/deletion/export procedures, and the approved AI data-processing policy for your customers. This repository does not establish those business decisions.
- Confirm role administration is operator-managed for the initial release. Owner/admin/staff currently share business-edit permissions; viewers are read-only. Self-service staff invitations and granular department permissions are future product features.
- Recheck dependency advisories during deployment. Keep Node, Firebase and upload parsers patched.

Do not label a production deployment verified until the staging/live checks above have actually passed with its real configuration.
