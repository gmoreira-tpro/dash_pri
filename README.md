# Hoffweb Priorities — Azure Static Web Apps

Internal dashboard for TDP and MAS Jira data, hosted on Azure Static Web Apps
with a managed Azure Function acting as a proxy to the Jira REST API.

## Why a proxy

Calling the Jira API directly from the browser was blocked by SharePoint's
CSP when the dashboard lived there. The Function in `/api/jira-proxy` moves
that call server-side: the browser talks to `/api/jira/...`, the Function
attaches the Jira credentials and forwards the request, and the response
comes back as plain JSON. No external call ever leaves the browser.

## Repo structure

```
/src                    static dashboard (HTML/JS)
/api/jira-proxy         Azure Function, proxies to Jira REST API
/api/todo-order         Azure Function, persists the drag-and-drop To Do order
/api/host.json          Functions host config
/api/local.settings.json  local-only env vars for swa-cli (not committed with real values)
staticwebapp.config.json  routing + auth config
```

## Order persistence

The Kanban "To Do" column can be reordered by drag-and-drop. That order is
saved through `/api/todo-order`, backed by Azure Table Storage — the same
storage account the Function app already needs for `AzureWebJobsStorage`,
so nothing extra to provision. The table (`TodoOrder`) is created
automatically on first save.

This is a **shared, team-wide order** — one saved order per project (TDP/MAS),
not one per person. Everyone who opens the dashboard sees whatever was last
confirmed. If per-user ordering is wanted instead, this needs a per-user
partition key added to `api/todo-order/index.js` (the signed-in user's
identity is available via the `x-ms-client-principal` header on
authenticated requests).

## Authentication

Access is restricted with Microsoft Entra ID, registered as a **single-tenant**
app so only T-Pro accounts can sign in — no separate domain allowlist needed.
Every route, including `/api/*`, requires an authenticated session
(`allowedRoles: ["authenticated"]`). Unauthenticated requests get redirected
to `/.auth/login/aad`.

## What needs to happen in Azure (one-time, needs infra access)

1. Create a Resource Group, with Gui as Contributor.
2. Create an App Registration in Entra ID:
   - Single tenant (T-Pro only)
   - Redirect URI: `https://<your-swa-name>.azurestaticapps.net/.auth/login/aad/callback`
   - Generate a client secret
3. In the Static Web App's Configuration, set:
   - `AAD_CLIENT_ID`
   - `AAD_CLIENT_SECRET`
   - `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`
   - `AzureWebJobsStorage` — connection string of a Storage Account (any general-purpose one works; this also backs the To Do order persistence via Table Storage)
4. Replace `<TENANT_ID>` in `staticwebapp.config.json` with the actual T-Pro
   tenant ID.

Once this is done, deploys and further changes don't need infra involvement —
they go through the GitHub Actions workflow Azure creates when the Static Web
App resource is linked to this repo.

## Local testing (no Azure account needed yet)

```bash
npm install -g @azure/static-web-apps-cli
swa start ./src --api-location ./api
```

Fill in real values in `api/local.settings.json` first — it's gitignored, so
they stay local.

## Security note

The previous Power Automate flow had the Jira token hardcoded in plain text.
This setup keeps every credential in environment variables, both locally and
in Azure, and none of them are committed to the repo.
