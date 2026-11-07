# Deploying to Vercel + Supabase (no command line needed)

1. **Vercel account** — vercel.com/signup → *Continue with GitHub*.
2. **Import** — *Add New… → Project* → choose `flashqc-digi-crm-` → **Deploy**.
   The first deploy has no database yet; that is expected.
3. **Database** — in the Vercel project: *Storage → Create Database → Supabase* → free plan,
   region **Mumbai (ap-south-1)** → *Create* → connect it to the project (all environments).
   This adds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_JWT_SECRET` and `POSTGRES_URL_NON_POOLING` automatically.
4. **Redeploy** — *Deployments → ⋯ → Redeploy*. The build runs `scripts/migrate.mjs`, which
   creates every table, security rule and the private recordings bucket.
5. **First sign-up becomes admin** — open the site, *Request access*, create your account.
6. **Connect Sarvam** — *Integrations → Connect Sarvam* → approve the code on Sarvam.

Optional environment variables: `INTEGRATION_ENCRYPTION_KEY` (otherwise derived from
`SUPABASE_JWT_SECRET`), `CRON_SECRET` (enables `/api/cron/campaigns`).
In Supabase → Authentication → URL Configuration, set the Site URL to your Vercel URL.
