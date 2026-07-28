# Deploy on Netlify

On Netlify the app runs in **serverless mode**: no Redis and no background
worker. Searches are advanced step-by-step by the dashboard itself (the
browser polls `/api/searches/[id]/tick` while a job runs). You only need
**Netlify + a free Neon Postgres database**.

## 1. Create the database (Neon, free)

1. Go to [neon.tech](https://neon.tech) and sign up (free).
2. Create a project (any name, e.g. `dex-sourcing`).
3. Copy the **connection string** — it looks like
   `postgresql://user:password@ep-xxx.aws.neon.tech/neondb?sslmode=require`

## 2. Create the Netlify site

1. [app.netlify.com](https://app.netlify.com) → **Add new site** → **Import an existing project**
2. Connect GitHub → pick `TheBoss845/dex-global-sourcing-ai`, branch `main`
3. Netlify reads `netlify.toml` from the repo — leave build settings as detected
   (build command comes from the file; publish dir `apps/web/.next`).

## 3. Environment variables

Site configuration → **Environment variables** → add:

| Key | Value |
|-----|-------|
| `DATABASE_URL` | the Neon connection string from step 1 |
| `AUTH_SECRET` | any long random string (e.g. 40 random characters) |
| `TAVILY_API_KEY` | `tvly-...` |
| `OPENAI_API_KEY` | `sk-...` (optional but recommended) |
| `RESEND_API_KEY` | `re_...` (optional — enables email verification) |
| `EMAIL_FROM` | `DEX <onboarding@resend.dev>` (only with Resend) |

`QUEUE_DRIVER=inline`, `AI_ENABLED=true`, and artifact settings are already
set in `netlify.toml`. Do **not** set `REDIS_URL` on Netlify.

## 4. Deploy

Trigger the first deploy (**Deploys → Trigger deploy**). The build runs
database migrations automatically (`pnpm db:migrate`).

When it finishes:

- `https://YOUR-SITE.netlify.app/api/health` → `"status":"ok"`
  (`redis: "skipped"` is correct in serverless mode)
- Sign in with an `@dex.com` email or `lmfelcher@gmail.com`
- Run a search — the pipeline tracker advances while the page is open

## Notes

- **Keep the tab open while a search runs.** In serverless mode the browser
  drives the pipeline; if you close the tab mid-search, reopen and re-run.
- Email verification activates automatically when `RESEND_API_KEY` and
  `EMAIL_FROM` are both set; otherwise allowed emails sign in instantly.
- Resend's test sender (`onboarding@resend.dev`) can only email the address
  that owns the Resend account. Verify a domain at
  [resend.com/domains](https://resend.com/domains) to email others.
- Render deployment (worker + Redis mode) still works — see
  [docs/render.md](render.md). The same repo supports both.
