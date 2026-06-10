# Vercel AI Action — required secrets

Add the following repository secrets in GitHub (Settings → Secrets → Actions) before the workflow will run successfully:

- `VERCEL_TOKEN` — a Vercel personal token with permissions to deploy (create via Vercel dashboard → Account → Tokens).
- `VERCEL_ORG_ID` — your Vercel organization ID (found in Vercel project settings or API response).
- `VERCEL_PROJECT_ID` — your Vercel project ID (found in Vercel project settings or API response).

Optional inputs (add as needed):
- `VERCEL_ENV` — `production` or `preview` (if the action supports it).

Notes:
- The workflow triggers on pushes to the `master` branch.
- After adding secrets, push a commit or re-run the workflow from GitHub Actions UI to trigger it.
