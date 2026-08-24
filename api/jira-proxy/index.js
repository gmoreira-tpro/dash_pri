/**
 * Jira proxy function.
 *
 * The frontend calls /api/jira/<path>?<query> instead of hitting
 * Atlassian directly. This function attaches auth and forwards the
 * request server-side, which is what solves the CSP problem we had
 * on SharePoint (external fetch blocked from the browser).
 *
 * Required app settings (Azure Portal > Static Web App > Configuration,
 * or local.settings.json for local testing):
 *   JIRA_BASE_URL   e.g. https://tprodublin.atlassian.net
 *   JIRA_EMAIL      the Atlassian account email tied to the API token
 *   JIRA_API_TOKEN  the API token itself
 *
 * None of these are hardcoded here. This is intentional — the previous
 * Power Automate flow had the token hardcoded in plain text, which is
 * the exact issue this setup avoids.
 */

module.exports = async function (context, req) {
  const { JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN } = process.env;

  if (!JIRA_BASE_URL || !JIRA_EMAIL || !JIRA_API_TOKEN) {
    context.res = {
      status: 500,
      body: { error: "Missing JIRA_BASE_URL, JIRA_EMAIL or JIRA_API_TOKEN in the Function app settings." },
    };
    return;
  }

  // req.params.path captures everything after /api/jira/
  // e.g. /api/jira/rest/api/3/search -> path = "rest/api/3/search"
  const path = req.params.path || "rest/api/3/search";

  const query = req.query || {};
  const queryString = new URLSearchParams(query).toString();
  const url = `${JIRA_BASE_URL}/${path}${queryString ? `?${queryString}` : ""}`;

  const authHeader = "Basic " + Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString("base64");

  try {
    const jiraResponse = await fetch(url, {
      method: req.method,
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: req.method === "POST" ? JSON.stringify(req.body) : undefined,
    });

    const contentType = jiraResponse.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
      ? await jiraResponse.json()
      : await jiraResponse.text();

    context.res = {
      status: jiraResponse.status,
      headers: { "Content-Type": "application/json" },
      body: data,
    };
  } catch (err) {
    context.res = {
      status: 502,
      body: { error: "Failed to reach the Jira API.", details: err.message },
    };
  }
};
