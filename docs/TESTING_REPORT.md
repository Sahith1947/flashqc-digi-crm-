# Phase 1 Testing Report

**Date:** 7 Nov 2026 · **Build:** production (`next build` + `next start`) against a freshly reset local Supabase stack (Postgres 17, GoTrue, PostgREST, Storage).

## Summary

| Suite | Command | Result |
| --- | --- | --- |
| TypeScript (strict) | `npm run typecheck` | ✅ 0 errors |
| ESLint (Next + React Compiler rules) | `npm run lint` | ✅ 0 errors, 0 warnings |
| Production build | `npm run build` | ✅ 27 routes; all app pages partially prerendered |
| Unit tests | `npm run test:unit` | ✅ 8/8 |
| Database tests | `npm run test:db` | ✅ all assertions (≈50) |
| End-to-end browser tests | `npm run test:e2e` | ✅ **83/83 steps** |
| Browser console errors / page errors / HTTP 5xx during E2E | (captured by the E2E runner) | ✅ **0** |
| Server log errors during final E2E | `next start` output | ✅ 0 |
| Mobile overflow (iPhone 13, 19 routes) | E2E + extra scan | ✅ none |

## What was tested

### Database (`supabase/tests/security_test.sql`, run in a rolled-back transaction)
- First user becomes active admin; later sign-ups are inactive viewers; last admin cannot be demoted.
- Anonymous users cannot read anything; pending (inactive) users see no data and cannot self-promote.
- Viewer is read-only; agent cannot create campaigns or numbers or delete contacts; manager cannot change org settings or integrations; admin cannot fake integration status.
- **Real-call integrity:** users cannot insert a completed real call, cannot attach provider IDs, cannot change a real call's status/duration, cannot flip `is_simulated`, cannot forge provider-webhook events; the backend can record verified results; the check constraint blocks a completed real call without a provider ID.
- Users cannot insert AI-sourced summaries or provider recordings; connection status cannot be claimed on insert or update.
- Duplicate phone numbers and duplicate campaign enrolments are rejected; invalid E.164 rejected.
- Audit log captures inserts and role changes.
- Analytics maths: `dashboard_summary` totals (total/inbound/outbound/answered/missed/failed/talk time/average/simulated), live-scope filtering, `call_trends` gap filling, `hourly_distribution` 24 buckets, `contacts_with_stats` counts.

### Unit (`tests/unit/lib.test.ts`)
Phone normalisation (Indian formats, international, invalid cases incl. spreadsheet scientific notation); RFC 4180 CSV parsing (quotes, escaped quotes, CRLF, BOM, multi-line cells); CSV formula-injection guard that keeps `+91…` numbers intact; header alias mapping; import validation and in-file duplicate detection; IST day boundaries, date presets, custom ranges, calling-window checks; duration formatting.

### End-to-end (`tests/e2e/run.cjs`) — full list of 83 steps in `tests/e2e/results.json` after a run
- **Authentication:** redirects, deep-link `next`, 401 for API, signup validation, admin bootstrap, pending approval, wrong password, approval & roles via Team tab, sign-out.
- **Navigation:** every route (18 incl. settings tabs) returns 200 with a heading and no error boundary; every sidebar link navigates and highlights; unknown/invalid IDs show 404.
- **Every form:** contacts (create/validate/duplicate/edit), phone numbers (validation, capability rule), voice agents (create/duplicate/edit), outbound dialer, inbound simulator, outcome/notes, transcript, summary, save-caller-as-contact, campaign wizard, campaign settings (window validation), add contacts, suppression list, profile, organisation settings, integration notes (secret refusal).
- **CSV:** import preview counts (new / existing / duplicate-in-file / invalid), import, re-import without duplicates, missing-phone rejection, filtered export, export → re-import round trip, call-log export, campaign report export.
- **Search / filter / sort / pagination:** contacts, call logs (direction, status, outcome, scope, recording, search, duration sort, page beyond range), campaign contacts, recordings.
- **Calling:** simulated outbound/inbound calls; live mode disabled without a provider; compliance blocks (revoked consent, DND without consent); missed-call callback queue equals a SQL computation; "Do not call" outcome auto-suppresses.
- **Recordings:** non-audio rejected; real WAV uploaded to the private bucket; playback via signed URL returns the file; the unsigned/public URL is refused; library listing, search and transcript/summary viewer.
- **Campaigns:** create from filter and from CSV; run simulated campaign to completion; compliance skips; retries never exceed max attempts and calls == attempts (no double-dialling); stats cards equal DB; pause/resume/cancel; cannot start empty; delete.
- **Dashboard & analytics:** every metric card equals a direct SQL count; live scope; chart table view sums equal DB; weekly/monthly toggle; custom range.
- **Integrations:** storage check verified and persisted; telephony and Sarvam checks honestly report "not configured" (error toast, status unchanged).
- **Permissions in the UI:** viewer and agent restrictions (hidden controls, redirected pages, disabled fields); admin delete flows.
- **API:** webhook rejects unconfigured provider; cron endpoint rejects missing/wrong secret and runs with the right one.
- **Mobile:** no horizontal overflow on 17 routes; navigation drawer.

## Bugs found and fixed during testing

| # | Bug | Fix |
| --- | --- | --- |
| 1 | After a validation error, React 19 form actions reset every field, wiping what the user typed (e.g. contact name lost, resubmit then failed). | New `useFormAction` hook submits in a transition without auto-reset; applied to all forms. |
| 2 | Call detail page crashed server-side: a render function was passed from a Server Component to a Client Component. | `EditableSection` now takes a serialisable editor spec. |
| 3 | "Save as contact" showed no confirmation: the form unmounted on revalidation before its toast effect ran. | Toast pushed from the submit callback (provider lives at the root). |
| 4 | Mobile: pages with tables were wider than the screen. Causes: grid items' `min-width:auto`, and `sr-only` labels escaping scroll containers. | `min-width:0` on grid children; scroll containers establish a containing block. |
| 5 | Chart axis text squashed/tiny on phones (stretched SVG viewBox). | Charts measure their container and draw at 1:1. |
| 6 | Sidebar `usePathname()` blocked prerendering of dynamic routes under Cache Components. | Static nav list prerenders; active highlight streams in behind Suspense. |
| 7 | Campaign "recent" query tried to embed a view PostgREST cannot join. | Stats fetched separately and merged. |
| 8 | Clock reads during prerender (`new Date()` in a layout, `Date.now()` keys). | Removed / moved to request-time code. |
| 9 | "Custom" date range fell back to 30 days and hid the date inputs. | Custom keeps its preset with a 30-day default window. |
| 10 | Overview recent-calls table and campaign contacts table were cramped. | Badges stacked, phones no-wrap, minimum column widths, fewer overview columns. |
| 11 | Small recordings displayed as "0.0 MB". | KB under 1 MB. |
| 12 | Several React-Compiler lint errors (setState in effects, components created during render, impure render). | Refactored. |

Test-script issues found along the way (bad CSV fixture, timing waits, a test expecting DND+consent to be blocked when it is correctly allowed) were fixed in the test, not by changing app behaviour.

## Known limitations / not covered
- **No external integrations were tested**, by design (Phase 2). The provider-webhook ingestion path (`CallEventService.ingestProviderEvent`) is implemented but cannot be exercised end-to-end without a real provider adapter; it will be tested with the provider's sample payloads in Phase 2.
- The E2E "real call" used for recording upload was created directly in the database as the backend would after a verified provider event (provider `e2e-test`), in the local test database only.
- The **manager** role is covered by database RLS tests; browser E2E used admin, agent and viewer accounts.
- Tested in Chromium (desktop 1440px and iPhone 13 emulation). Safari/Firefox were not run.
- Load/performance testing beyond a few hundred rows was not performed; queries are indexed and paginated, and exports stream in 1,000-row pages.

## How to re-run
```bash
npx supabase start
npm run db:reset && npm run test:db && npm run test:unit
npm run build && npm start            # in another terminal
npm run test:e2e                      # requires a freshly reset DB
```

## Update: continuous Call IDs, bulk delete, superseded Sarvam attempts

- Call IDs (CL-000001 …) are renumbered 1..N in original order after any delete; new calls take N+1. Users (even admins) cannot edit a Call ID by hand. Covered by `npm run test:db`.
- Call Logs has tick boxes and **Delete selected** for admins (hidden for other roles). Covered by e2e step "Admin: bulk delete selected calls…" (86/86 e2e steps pass).
- Sarvam attempts from a replaced campaign ("Campaign Cancelled") no longer fail a re-queued live call; the real attempt updates the same call. Covered by `npm run test:webhooks` (29/29).
- Recordings: Sarvam's analytics report returns `audio_url: null` for every interaction in this workspace (checked 8 Nov 2026), and its MCP has no recording setting. Recordings need Sarvam support to enable them, or Vobiz trunk recording with Vobiz API keys.

## Update: call recordings through Vobiz

Sarvam returns no audio for this workspace. Checked 8 Nov 2026 in every place it could appear: the webhook `recording_url`, the analytics `audio_url`, the interaction trace (only audio hashes) and the transcript report (only timings). Its agent config also has no recording switch.
The CRM now pulls recordings from **Vobiz**, the SIP trunk behind the Sarvam number:
- Integrations → "Call Recordings (Vobiz)": an admin pastes the Vobiz Auth ID and Auth Token once. The keys are verified against Vobiz, then stored AES-GCM encrypted in `integration_credentials` (service role only) and never sent to the browser.
- Sync: `GET /api/v1/Account/{auth_id}/Recording/`. Each recording is matched to an answered real call by the customer's number and time (closest, within 10 minutes). The audio is downloaded into the private `call-recordings` bucket and played with signed links. A recording is attached at most once.
- When it runs: on page visits (throttled, after the response), on the call page's "Check for recording" button, on "Sync recordings now", and on the cron endpoint.
- `npm run test:vobiz` (18/18) runs against a fake Vobiz server and covers wrong keys, encryption, matching, private storage, playback, idempotency, cron, disconnect and no token leaks.
