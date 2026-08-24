/**
 * Persists the drag-and-drop "To Do" priority order so it survives page
 * reloads once this dashboard is hosted outside Claude.ai (where the
 * window.storage artifact API doesn't exist).
 *
 * Storage: Azure Table Storage, using the same connection string the
 * Functions runtime already needs (AzureWebJobsStorage) — no extra
 * resource to provision.
 *
 * The order is shared team-wide: one saved order per project (TDP/MAS),
 * not one per user. Everyone who opens the dashboard sees the same
 * drag-and-drop order everyone else last confirmed. If that's not what's
 * wanted — e.g. each person should get their own view — this needs a
 * per-user partition key instead (the signed-in user's Entra ID is
 * available via the x-ms-client-principal header on authenticated
 * requests), which isn't wired up here.
 *
 * GET  /api/todo-order/{project}   -> { order: [...] } or { order: null }
 * PUT  /api/todo-order/{project}   body: { order: [...] }
 */

const { TableClient } = require("@azure/data-tables");

const TABLE_NAME = "TodoOrder";

function getTableClient() {
  const connectionString = process.env.AzureWebJobsStorage;
  if (!connectionString) {
    throw new Error("AzureWebJobsStorage is not configured.");
  }
  return TableClient.fromConnectionString(connectionString, TABLE_NAME);
}

async function ensureTable(client) {
  try {
    await client.createTable();
  } catch (err) {
    // 409 = table already exists, which is the expected steady state
    if (err.statusCode !== 409) throw err;
  }
}

module.exports = async function (context, req) {
  const project = context.bindingData.project;
  if (!project || !["TDP", "MAS"].includes(project.toUpperCase())) {
    context.res = { status: 400, body: { error: "project must be TDP or MAS." } };
    return;
  }
  const rowKey = project.toUpperCase();

  let client;
  try {
    client = getTableClient();
    await ensureTable(client);
  } catch (err) {
    context.res = { status: 500, body: { error: "Storage not configured.", details: err.message } };
    return;
  }

  if (req.method === "GET") {
    try {
      const entity = await client.getEntity("order", rowKey);
      context.res = { status: 200, body: { order: JSON.parse(entity.orderJson) } };
    } catch (err) {
      if (err.statusCode === 404) {
        context.res = { status: 200, body: { order: null } };
      } else {
        context.res = { status: 500, body: { error: "Failed to read saved order.", details: err.message } };
      }
    }
    return;
  }

  if (req.method === "PUT") {
    const order = req.body && req.body.order;
    if (!Array.isArray(order)) {
      context.res = { status: 400, body: { error: "Body must be { order: string[] }." } };
      return;
    }
    try {
      await client.upsertEntity(
        { partitionKey: "order", rowKey, orderJson: JSON.stringify(order) },
        "Replace"
      );
      context.res = { status: 200, body: { saved: true } };
    } catch (err) {
      context.res = { status: 500, body: { error: "Failed to save order.", details: err.message } };
    }
    return;
  }

  context.res = { status: 405, body: { error: "Method not allowed." } };
};
