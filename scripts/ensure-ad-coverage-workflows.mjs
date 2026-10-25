/** Add completion evidence to the live Meta/Snap n8n ingest payloads. */
const API = "https://n8n.engosoft.com/api/v1";
const key = process.env.N8N_API_KEY;
const apply = process.argv.includes("--apply");
if (!key) throw new Error("N8N_API_KEY is required.");

async function api(path, method = "GET", body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`n8n ${method} ${path}: HTTP ${response.status}`);
  return result;
}

function replaceOnce(source, before, after) {
  if (!source.includes(before))
    throw new Error(`Expected workflow code fragment not found: ${before}`);
  return source.replace(before, after);
}

function patchMeta(nodes) {
  const node = nodes.find((item) => item.name === "Prepare Meta PostgreSQL Heartbeat");
  if (!node) throw new Error("Meta completion node missing.");
  let code = node.parameters.jsCode;
  if (code.includes("accountCount: verifiedAccounts.length")) return false;
  code = replaceOnce(
    code,
    "const window = $('Build Safe Date Window').first().json;",
    `const window = $('Build Safe Date Window').first().json;
const discovered = $('Discover + Build Work Items').all().map((item) => item.json.account || {});
const verifiedAccounts = [...new Map(discovered
  .filter((account) => /^act_\\d+$/.test(String(account.id || '')))
  .map((account) => [String(account.id), {
    id: String(account.id),
    name: String(account.name || account.id),
    currency: String(account.currency || ''),
  }])).values()];
if (!verifiedAccounts.length || verifiedAccounts.some((account) => account.currency !== 'USD')) {
  throw new Error('Meta account inventory is empty or has a non-USD currency.');
}`,
  );
  code = replaceOnce(
    code,
    "    completed: true,",
    "    completed: true,\n    accounts: verifiedAccounts,\n    accountCount: verifiedAccounts.length,",
  );
  node.parameters.jsCode = code;
  return true;
}

function patchSnap(nodes) {
  const node = nodes.find((item) => item.name === "Prepare Snap PostgreSQL Payload");
  if (!node) throw new Error("Snap payload node missing.");
  let code = node.parameters.jsCode;
  if (code.includes("accountCount: verifiedAccounts.length")) return false;
  code = replaceOnce(
    code,
    "const sourceRows = Array.isArray(fetched.rows) ? fetched.rows : [];",
    `const sourceRows = Array.isArray(fetched.rows) ? fetched.rows : [];
const errors = Array.isArray(fetched.errors) ? fetched.errors : [];
if (errors.length) throw new Error('Snap account fetch was incomplete: ' + errors.join(' | ').slice(0, 500));
const configured = String($('Snap Configuration').first().json.SNAP_AD_ACCOUNT_ID || '');
const verifiedAccounts = [...new Set(configured.split(',').map((id) => id.trim()).filter(Boolean))]
  .map((id) => ({ id, name: id, currency: 'USD' }));
if (!verifiedAccounts.length || Number(fetched.accountCount) !== verifiedAccounts.length) {
  throw new Error('Snap fetched account count does not match configured accounts.');
}`,
  );
  code = replaceOnce(
    code,
    "    receivedRows: rows.length,",
    "    receivedRows: rows.length,\n    completed: true,\n    accounts: verifiedAccounts,\n    accountCount: verifiedAccounts.length,",
  );
  node.parameters.jsCode = code;
  return true;
}

for (const [platform, id, patch] of [
  ["meta", "imS2VrWslYHhnFNn", patchMeta],
  ["snapchat", "x9iHWEw7cE3ELqOp", patchSnap],
]) {
  const workflow = await api(`/workflows/${id}`);
  const nodes = structuredClone(workflow.nodes);
  const changed = patch(nodes);
  if (changed) {
    const codeNode = nodes.find(
      (item) =>
        item.name ===
        (platform === "meta"
          ? "Prepare Meta PostgreSQL Heartbeat"
          : "Prepare Snap PostgreSQL Payload"),
    );
    new Function(codeNode.parameters.jsCode);
  }
  if (changed && apply) {
    await api(`/workflows/${id}`, "PUT", {
      name: workflow.name,
      nodes,
      connections: workflow.connections,
      settings: workflow.settings,
    });
  }
  console.log(JSON.stringify({ platform, id, changed, applied: changed && apply }));
}
