# FlashQC Digi – Call Operations CRM

A calling-focused CRM for FlashQC Digi: inbound and outbound calls, bulk calling
campaigns, call logs, recordings, transcripts, AI summaries, contacts, phone
numbers, voice agents and analytics.

**Status: Phase 1 complete.** The CRM is fully functional on its own. External
integrations (Sarvam AI, MCP, telephony) are prepared behind provider-independent
interfaces and will be implemented in Phase 2 from the official documentation.
Until then, live calling is disabled and a clearly labelled **simulation mode**
lets you exercise every workflow.

## Stack

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router, Server Components, Server Actions, Cache Components / PPR), React 19, TypeScript (strict) |
| UI | Tailwind CSS v4, lucide-react icons, hand-built SVG charts (no chart library) |
| Data | Supabase: PostgreSQL, Auth, Row Level Security, private Storage bucket |
| Validation | zod (server), shared pure validators (phone, CSV) used on client and server |

Runtime dependencies were kept deliberately small: `@supabase/ssr`, `@supabase/supabase-js`, `zod`, `lucide-react`, `server-only`.

## Getting started (local)

Requirements: Node 20.9+, Docker (for the local Supabase stack).

```bash
npm install
npx supabase start          # starts Postgres, Auth, REST and Storage locally
cp .env.example .env.local  # then paste the keys printed by `supabase start`
npm run dev                 # http://localhost:3000
```

The **first account that signs up becomes the admin**. Everyone after that is
created inactive and must be approved (and given a role) by an admin in
**Settings → Team**.

> If Docker Hub is reachable but `public.ecr.aws` is not, run Supabase with
> `SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase start`.

### Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | public | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | public | Publishable (anon) key – safe in the browser; RLS protects data |
| `SUPABASE_SECRET_KEY` | **server only** | Service-role key for verified provider webhooks, the scheduled campaign job and storage health checks |
| `CRON_SECRET` | server only | Bearer token for `POST /api/cron/campaigns` |
| `TELEPHONY_PROVIDER`, `SARVAM_API_KEY`, `TELEPHONY_WEBHOOK_SECRET` | server only | Phase 2 — leave empty for now |

No secret is ever stored in the database or sent to the browser. The
Integrations page only shows whether each variable is *set*.

### Deploying

1. Create a Supabase project and run the migrations: `npx supabase link` then `npx supabase db push`.
2. Deploy the Next.js app (e.g. Vercel) with the environment variables above.
3. In Supabase Auth settings, set the Site URL and add `<your-domain>/auth/callback` as a redirect URL. Consider disabling public sign-ups once your team has joined.
4. Optional: schedule `POST /api/cron/campaigns` every minute with `Authorization: Bearer $CRON_SECRET` so campaigns progress without a browser tab open.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run typecheck`, `npm run lint` | TypeScript and ESLint |
| `npm run test:unit` | Unit tests (phone normalisation, CSV parsing/injection guard, import validation, IST date logic) |
| `npm run test:db` | Database tests: RLS for every role, call-integrity guards, audit logging, analytics maths (rolled back) |
| `npm run test:e2e` | Browser end-to-end suite (needs a freshly reset DB and the app on :3000) |
| `npm run db:reset` | Re-create the local database from migrations |
| `npm run db:types` | Regenerate `src/lib/supabase/database.types.ts` |

## Architecture

```
src/
  app/
    (auth)/            login, signup, pending-approval pages + auth actions
    (app)/             the CRM: one folder per sidebar module, each with page.tsx + actions.ts
    api/export/*       CSV exports (calls, contacts, campaign reports)
    api/webhooks/telephony/[provider]   provider webhook (rejects everything until Phase 2)
    api/cron/campaigns scheduled campaign processing
  components/          ui kit, charts, and feature components (calls, contacts, campaigns, …)
  lib/                 pure, shared modules: phone, csv, contact-import, dates (IST), constants
  server/
    auth.ts            session + role guards (requireMember for pages, assertRole for actions)
    services/          VoiceAgentService, TelephonyService, CallEventService, RecordingService,
                       TranscriptService, CampaignService (+ ContactService, IntegrationService)
    providers/         provider-independent interfaces, registry, simulator, "not configured" adapters
    queries/           read-side query builders shared by pages and CSV exports
supabase/
  migrations/          schema, security (RLS, guards, audit), analytics functions, views
  tests/               database security & logic tests
tests/                 unit and end-to-end tests
```

### Data integrity guarantees (enforced in the database, not just the UI)

- **A real call can never be shown as completed without provider confirmation.** End users can only create a real call as `queued`; status, timestamps, duration and provider IDs of real calls can only be written by the backend (service role) after a verified provider event. A check constraint also requires a provider call ID for any real call past `queued/failed/canceled`.
- **Simulated data is permanently marked.** `calls.is_simulated` cannot be changed after insert; simulated calls never get recordings; every list, detail page, export and dashboard labels them, and dashboards have a Live/Simulated scope filter.
- **Connection statuses cannot be faked.** `connection_status` on numbers/agents and `status` on integrations are writable only by the backend after a real check.
- **No duplicates.** Phone numbers are unique (E.164) for contacts, business numbers and the suppression list; campaign enrolment is unique per contact; CSV imports de-duplicate within the file and against the database.
- **Compliance.** Suppressed numbers, revoked consent and DND-without-consent are blocked for manual and campaign calls. "Do not call" outcomes add the number to the suppression list automatically. Live campaigns respect the IST calling window.
- **Audit trail.** Triggers record inserts/updates/deletes on all configuration and CRM tables with the acting user.

### Roles

| Role | Can |
| --- | --- |
| Viewer | Read everything (except team & audit log), export CSVs |
| Agent | + create/edit contacts, import CSVs, place/simulate calls, outcomes & notes, upload recordings, manual transcripts/summaries, add suppressions |
| Manager | + campaigns, phone numbers, voice agents, delete contacts/recordings, remove suppressions |
| Admin | + team approval & roles, integrations, organisation settings, audit log, delete calls/numbers/agents |

Roles are enforced three times: UI (controls hidden), server actions (`assertRole`), and PostgreSQL RLS.

### Time zones

All timestamps are stored as UTC `timestamptz`. Display, date filters and
analytics buckets (day/week/month/hour) use **Asia/Kolkata**.

See `docs/` for the testing report and the Phase 2 integration requirements.
