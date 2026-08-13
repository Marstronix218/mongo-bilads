# Claude Code handoff: finish the InsForge persistence upgrade

Date: 2026-07-13 (America/Los_Angeles)

## Latest product requirement (authoritative)

The user explicitly does **not** want login, signup, accounts, auth screens, or user-specific features.

Use InsForge for:

- durable campaign records;
- generated creative metadata;
- product and generated-image storage;
- agent-run telemetry;
- BAND messages and approval/decision events;
- optionally the outbound queue.

The intended model is one shared Bilads workspace, accessed only through the server-side InsForge project-admin SDK. Do not reintroduce `auth.users`, cookie auth, organization membership, an anon client, or login UI.

## Important: the worktree is intentionally mid-pivot

The first implementation pass was account-oriented. The user then rejected accounts. The local SQL migration has been rewritten for the new single-workspace design, but the TypeScript application is still partly wired to the superseded user/auth model.

Do **not** treat the current worktree as finished or merge it as-is.

Current backend branch:

- InsForge branch: `codex-insforge-foundation`
- Parent project: `bilads`
- The parent project has not been merged or modified by this work.
- The branch database currently has the earlier account-oriented version of migration `20260714001745` applied.
- The local file `migrations/20260714001745_bilads-foundation.sql` now contains the newer no-account, single-workspace schema.
- Therefore the branch database and local migration are currently out of sync.

## Files that must be removed

These were added for account auth and now contradict the requirement:

- `app/lib/insforge-auth.ts`
- `app/app/api/auth/refresh/route.ts`
- `app/proxy.ts`
- `app/app/login/actions.ts`
- `app/app/login/page.tsx`

Also remove the Account link from `app/app/page.tsx`.

Use `apply_patch` for file deletion/editing, per this repository's agent instructions.

## Files worth keeping and finishing

These changes are directionally correct but need the auth-to-workspace pivot completed:

- `migrations/20260714001745_bilads-foundation.sql`
  - New single-workspace schema.
  - Uses a seeded `bilads` workspace with fixed UUID `00000000-0000-4000-8000-000000000001`.
  - Enables RLS but creates no anon/authenticated policies.
  - Revokes app-table/function access from `anon` and `authenticated`.
  - Keeps typed constraints, composite workspace/campaign FKs, append-only event tables, lifecycle triggers, and idempotent RPCs.
- `app/lib/insforge.ts`
  - Already removed the old raw REST client and fake in-memory success path.
  - Already uses `server-only`, `createAdminClient`, SDK array inserts, and explicit errors.
  - Needs field names changed from organization/user terminology to workspace/subject terminology.
- `app/lib/images.ts`
  - Already preserves both Storage `url` and `key`, plus MIME type, byte size, and SHA-256.
  - Needs `organizationId` renamed to `workspaceId` in its storage scope.
- `app/lib/attention.ts`
  - Already supports scoped generated-image keys and downloads through the admin client.
- `app/app/api/campaigns/route.ts`
  - Already creates campaigns through an idempotent RPC and uploads product images to the private bucket.
  - Must switch from a user client to the admin client and include `p_workspace_slug: "bilads"` in RPC calls.
- `app/app/api/research/route.ts`
  - Already starts/finishes durable agent runs and persists research.
  - Must remove user-session checks and use the server admin repository.
- `app/app/api/generate/route.ts`
  - Already persists creative variants and storage metadata.
  - Must remove user-session checks and use the single workspace.
- `app/app/api/band/route.ts` and `app/lib/band.ts`
  - Already await message persistence and record approval decisions.
  - Must replace user identity with truthful unverified subject labels such as `shared-web`.
- `app/app/api/kylon/route.ts`
  - Already changed toward a machine-only bearer route and durable run telemetry.
- `app/app/campaigns/`
  - The saved-campaign UI is a database feature, not an account feature, so it can remain.
  - Refactor the server page to use the admin client directly; remove its login redirect.
- `types.ts` and generated `app/lib/types.ts`
  - Keep `campaignId`, `requestId`, and creative `asset` metadata.
  - Rename `CampaignRecord.organizationId` to `workspaceId`.

## Required application refactor

### 1. Replace account authorization with a browser-or-machine request gate

Rewrite `app/lib/apiAuth.ts` so it has no InsForge auth client and no `UserSchema`.

Suggested result:

```ts
type ApiPrincipal =
  | { kind: "shared-web"; subject: "shared-web" }
  | { kind: "machine"; subject: "kylon" };
```

Rules:

1. If an `Authorization` header is present, evaluate it only as a machine bearer.
2. A bad bearer must return 401 and must never fall back to browser rules.
3. `/api/kylon` permits only the machine principal.
4. Browser routes require an exact configured Origin (prefer `BILADS_APP_ORIGIN`, with a safe localhost default only in development) and JSON content type for JSON POSTs.
5. `Origin`/`Sec-Fetch-Site` is CSRF/request shaping, **not real authentication**. With no accounts, public visitors can still call shared browser APIs. Document that honestly.

Do not expose `INSFORGE_API_KEY` to the browser and do not create a generic table/SQL endpoint.

### 2. Make `app/lib/insforge.ts` the narrow server repository

Keep `createAdminClient` lazy and server-only. Add/export a narrow admin database accessor or capability helpers; do not restore `insertRow(tableName, arbitraryData)`.

Update agent-run fields:

- insert `workspace_id` using the fixed Bilads workspace ID;
- replace `initiated_by` with `initiated_by_subject`;
- replace returned `organization_id` with `workspace_id`;
- keep campaign/request/agent idempotency;
- await required writes and surface failures.

Update agent-message fields:

- `workspaceId`, not `organizationId`;
- no `actorUserId`;
- use `actorSubject` only and treat it as an unverified label.

### 3. Update campaign helpers and routes

In `app/lib/campaigns.ts`:

- change `organization_id` to `workspace_id`;
- return `workspaceId` from `campaignToApi`.

In all RPC calls, add:

```ts
p_workspace_slug: "bilads"
```

The rewritten migration uses this parameter for:

- `create_campaign`
- `set_campaign_research`
- `record_product_asset`
- `save_creative_generation`
- `record_approval`

`record_approval` also now requires:

```ts
p_decided_by_subject: principal.subject
```

All campaign lookups/listing should use the server admin client and should never accept a workspace ID/slug from the request.

### 4. Update generated asset paths

The required path shape is:

```text
<workspace_uuid>/<campaign_uuid>/generated/<filename>.png
<workspace_uuid>/<campaign_uuid>/product/<uuid>.<ext>
```

The server derives every bucket and key. Never accept bucket names or object keys from browser input.

Buckets:

- `generated-creatives`: currently public, because the UI uses direct image URLs.
- `product-assets`: private and server-only.

The private product upload should persist URL, key, MIME, size, and SHA-256 through `record_product_asset`. If DB metadata persistence fails after upload, delete the uploaded object.

### 5. Remove auth environment/config assumptions

Update `.env.example`:

- keep `INSFORGE_BASE_URL`, `INSFORGE_API_KEY`, and `INSFORGE_PROJECT_ID`;
- remove `INSFORGE_ANON_KEY`, `NEXT_PUBLIC_INSFORGE_URL`, and `NEXT_PUBLIC_INSFORGE_ANON_KEY`;
- add optional `BILADS_APP_ORIGIN` for exact browser Origin checks;
- keep `BILADS_API_KEY` for machine-only Kylon calls.

Update `insforge.toml` so it no longer configures account/password/email behavior. A minimal version should retain only the supported operational settings actually wanted, for example:

```toml
[storage]
max_file_size_mb = 10

[realtime]
retention_days = 0

[schedules]
retention_days = 7
```

The ignored `app/.env.local` currently contains branch credentials and may contain now-unused anon variables. Do not print its values. Remove obsolete anon variables if convenient, but preserve unrelated user secrets.

## Backend reconciliation sequence

The development branch is disposable and contains no user data. Once the TypeScript pivot is complete:

1. Confirm the active CLI context is `codex-insforge-foundation` without using JSON output that prints secrets:

   ```bash
   npx @insforge/cli current
   npx @insforge/cli branch list
   ```

2. Reset only the development branch so the rewritten migration can be tested from a clean T0:

   ```bash
   npx @insforge/cli --yes \
     --reason "Reapply the no-account Bilads persistence migration on the disposable development branch" \
     --impact "Resets only codex-insforge-foundation; the parent project is untouched" \
     branch reset codex-insforge-foundation
   ```

3. Wait until `branch list` reports `ready`.

4. Apply the local migration:

   ```bash
   npx @insforge/cli db migrations up --to 20260714001745_bilads-foundation.sql
   ```

5. Recreate `product-assets` because branch reset also removes branch-only bucket/config changes:

   ```bash
   npx @insforge/cli storage create-bucket product-assets --private
   ```

6. Apply the trimmed config:

   ```bash
   npx @insforge/cli config plan --file insforge.toml
   npx @insforge/cli config apply --file insforge.toml --dry-run
   npx @insforge/cli config apply --file insforge.toml --auto-approve
   ```

7. Do not merge the branch into the parent without explicit user approval. A dry-run merge is allowed for review:

   ```bash
   npx @insforge/cli branch merge codex-insforge-foundation --dry-run
   ```

## Security checks to run

The no-account design relies on the admin server as the only database principal. Verify:

- RLS is enabled on every app table.
- There are no anon/authenticated policies.
- `anon` and `authenticated` have no table privileges.
- RPC execute privileges are absent for `PUBLIC`, `anon`, and `authenticated`.
- Direct anon reads/writes fail.
- App admin CRUD succeeds only through the narrow server routes/repository.
- Invalid machine bearer headers return 401 and never fall back to shared-web handling.
- Product assets are private; generated art is intentionally public.
- Agent events and approvals reject update/delete.
- Cross-campaign composite foreign keys reject mismatched references.
- Idempotent retries return the same row, while reusing a request ID with different data fails.

Recommended hardening not yet implemented: rate limits and spend/concurrency limits for public AI/image routes. Without login, same-origin checks cannot prevent a direct HTTP client from invoking public shared-workspace APIs.

## Verification commands

After editing:

```bash
cd app
npm run sync
npx tsc --noEmit
npx eslint \
  lib/insforge.ts lib/apiAuth.ts lib/campaigns.ts lib/images.ts lib/attention.ts lib/band.ts \
  app/api/campaigns/route.ts app/api/research/route.ts app/api/generate/route.ts \
  app/api/band/route.ts app/api/kylon/route.ts app/campaigns/page.tsx \
  app/campaigns/CampaignList.tsx app/results/BandDiscussion.tsx app/page.tsx
npm run build
```

The repository's full `npm run lint` currently scans generated `.vercel/output` and also reports pre-existing React-effect errors in unrelated files. Use targeted lint for the changed surface, and record any remaining pre-existing failures separately.

## Credential hygiene

- Never print `.env.local`, `.insforge/project.json`, connection strings, or CLI JSON branch output.
- The development branch admin API key appeared in prior internal tool output. Rotate the branch API key before final handoff, then refresh the linked branch context using the CLI rather than manually editing `.insforge/project.json`.
- Update ignored `app/.env.local` with the rotated key without echoing it.
- Do not hardcode or commit any credentials.

## Definition of done

- No login/account/auth files or UI remain.
- No anon/browser InsForge client remains.
- The app uses only the server admin SDK for database and storage.
- Campaign creation, research, creatives, assets, agent runs/messages, and approvals persist in the singleton Bilads workspace.
- Saved campaigns can be listed/reopened without an account.
- The rewritten migration applies cleanly on the isolated branch.
- Private/public bucket behavior is verified.
- Typecheck, targeted lint, and production build pass (apart from clearly identified pre-existing issues).
- A branch merge dry-run is reviewed, but the parent is not merged without explicit user approval.
