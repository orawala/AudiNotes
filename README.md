# AudiNotes — Supabase login step

## Install
Upload these files to the root of your GitHub repository:
- `index.html`
- `styles.css`
- `app.js`
- `config.js`
- `auth.js`
- `README.md`

## Configure Supabase
Edit `config.js` and replace:
- `PASTE_YOUR_SUPABASE_PROJECT_URL_HERE`
- `PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE`

Use the Project URL and publishable key from Supabase Project Settings → API Keys. Never use a database password, secret key, or service_role key in frontend code.

## Enable email/password
In Supabase, open Authentication → Sign In / Providers (menu may vary) and ensure Email is enabled. For initial testing, you may turn off email confirmation in Authentication → Settings only if you understand that accounts will then be created without verifying email. Prefer leaving confirmation enabled for a real deployment.

## What this step does
- Email/password sign-up and sign-in
- Persistent Supabase session in the browser
- Sign out
- Auth gate around the AudiNotes interface

## Important
This step connects authentication only. The existing note/project prototype still uses browser-local data. The next step will replace local note/project storage with the Supabase database and then set up private audio storage. Do not enter secret keys in `config.js`.
