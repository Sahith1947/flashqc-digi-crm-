# Turning on "Continue with Google"

The CRM code is ready. Google requires the account owner to create a sign-in key once.
You copy two values between Google and Supabase — about 10 minutes, all in the browser.

## Part A — Supabase: copy the callback address
1. Vercel → your project → **Storage** → your Supabase database → **Open in Supabase**.
2. **Authentication → Sign In / Providers → Google**.
3. Copy the **Callback URL (for OAuth)**. It looks like `https://xxxx.supabase.co/auth/v1/callback`.
   Keep this tab open.

## Part B — Google: create the sign-in key
1. Open **https://console.cloud.google.com/** and sign in with your Gmail.
2. Top bar → project picker → **New project** → name `FlashQC CRM` → **Create** → select it.
3. Menu → **APIs & Services → OAuth consent screen** (may be called **Google Auth Platform**) → **Get started**.
   App name `FlashQC Digi CRM`, support email = your Gmail, audience **External**, contact email = your Gmail → **Create**.
4. **Clients → Create client** → type **Web application** → name `FlashQC CRM`.
5. Under **Authorized redirect URIs** → **Add URI** → paste the Callback URL from Part A → **Create**.
6. Copy the **Client ID** and **Client secret** shown.
7. **Audience → Publish app** (otherwise only test users you add can sign in).

## Part C — Supabase: switch Google on
1. Back in Supabase (Part A tab): turn **Enable Sign in with Google** on.
2. Paste **Client ID** and **Client Secret** → **Save**.
3. **Authentication → URL Configuration**:
   - **Site URL**: `https://flashqc-digi-crm.vercel.app`
   - **Redirect URLs** → **Add URL**: `https://flashqc-digi-crm.vercel.app/**` → **Save**.

## Part D — Try it
Open https://flashqc-digi-crm.vercel.app → **Continue with Google** → choose
bokkisamsahith@gmail.com. That address becomes an **Admin** automatically
(Settings → Organisation → *Auto-approved admin emails*). Anyone else who signs in with
Google waits for an admin to approve them in Settings → Team.
