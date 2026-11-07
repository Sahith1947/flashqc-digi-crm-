# Phase 1 Implementation Plan (as executed)

## 0. Starting point
The working directory was empty and none of the existing GitHub repositories
(`Flashqc-Mart`, `westindiwlaievent-`, `sfi-finance-`, …) contained a calling CRM,
so the CRM was built as a new, standalone project. Supabase PostgreSQL was used
as requested.

## 1. Decisions
| Topic | Decision | Why |
| --- | --- | --- |
| Framework | Next.js 16 App Router, Server Components + Server Actions | Server-side data access keeps keys and logic off the client; one deployable |
| Rendering | Cache Components / Partial Prerendering | Static shell (sidebar) loads instantly; per-user data streams in |
| Database | Supabase Postgres with RLS on every table | Security enforced at the data layer, not just in the UI |
| Real-call integrity | DB triggers + check constraint | A real call cannot be completed/updated by a user session — only by verified provider events |
| Simulation | Separate `is_simulated` flag, immutable, labelled everywhere; can be disabled in Settings | Test all workflows without telephony and without misleading data |
| Charts | Hand-built SVG components | No chart dependency; small bundle; consistent styling; accessible table view |
| CSV | Own RFC 4180 parser + formula-injection-safe writer | No dependency; shared by client preview and server re-validation |
| Phone numbers | Normalised to E.164 (+91 default), unique per table | Reliable duplicate detection |
| Time | UTC storage, Asia/Kolkata display and bucketing | As specified |
| Integrations | Capability-specific provider interfaces + registry + "not configured" defaults | Sarvam/MCP may support only some operations; nothing assumed |

## 2. Build order
1. Scaffold, local Supabase stack.
2. Database: 14 required tables (+ `app_settings`), constraints, indexes, timestamps, RLS, guard triggers, audit triggers, private storage bucket, analytics functions and views. Database test suite.
3. Pure libraries with unit tests (phone, CSV, import validation, IST dates).
4. Provider interfaces, simulator, and services: VoiceAgentService, TelephonyService, CallEventService, RecordingService, TranscriptService, CampaignService (+ ContactService, IntegrationService).
5. UI kit, app shell, authentication with admin approval.
6. Modules: Overview → Call Logs → Call detail → Outbound/Inbound → Contacts (+ CSV import/export) → Campaigns → Recordings → Phone Numbers → Voice Agents → Analytics → Integrations → Settings.
7. Production build, lint, typecheck; end-to-end suite; fix discovered bugs; reports.

## 3. Out of scope for Phase 1 (by instruction)
Any real call to Sarvam AI, MCP, or a telephony provider. See
`PHASE2_INTEGRATION_REQUIREMENTS.md`.
