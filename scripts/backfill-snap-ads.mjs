/** Safely add all accessible Snap accounts and run a bounded historical sync. */
const API = "https://n8n.engosoft.com/api/v1";
const WORKFLOW_ID = "x9iHWEw7cE3ELqOp";
const ACCOUNTS = [
  "ca38be49-409a-4919-8ec1-da6237614309", // Engosoft general
  "f233d311-bd5b-404d-92df-ac72c1a93383", // Engosoft Global Self Service
];
const key = process.env.N8N_API_KEY;
if (!key) throw new Error("N8N_API_KEY is required.");
const [command, from, to] = process.argv.slice(2);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

async function api(path, method = "GET", body) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { "X-N8N-API-KEY": key, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(
      `n8n ${method} ${path}: ${response.status} ${JSON.stringify(result).slice(0, 500)}`,
    );
  return result;
}

function withAccounts(workflow) {
  const nodes = structuredClone(workflow.nodes);
  const node = nodes.find((item) => item.name === "Snap Configuration");
  if (!node) throw new Error("Snap Configuration node was not found.");
  const assignment = node.parameters.assignments.assignments.find(
    (item) => item.name === "SNAP_AD_ACCOUNT_ID",
  );
  if (!assignment) throw new Error("Snap account configuration was not found.");
  assignment.value = ACCOUNTS.join(",");
  return nodes;
}

if (command === "fix") {
  const workflow = await api(`/workflows/${WORKFLOW_ID}`);
  const nodes = withAccounts(workflow);
  const changed = JSON.stringify(nodes) !== JSON.stringify(workflow.nodes);
  if (changed) {
    await api(`/workflows/${WORKFLOW_ID}`, "PUT", {
      name: workflow.name,
      nodes,
      connections: workflow.connections,
      settings: workflow.settings,
    });
  }
  console.log(JSON.stringify({ id: WORKFLOW_ID, changed, accounts: ACCOUNTS.length }));
} else if (command === "start") {
  if (!datePattern.test(from || "") || !datePattern.test(to || "") || from > to) {
    throw new Error("Use start YYYY-MM-DD YYYY-MM-DD.");
  }
  const original = await api(`/workflows/${WORKFLOW_ID}`);
  const nodes = withAccounts(original);
  const config = nodes.find((item) => item.name === "Snap Configuration");
  config.parameters.assignments.assignments.find(
    (item) => item.name === "INITIAL_START_DATE",
  ).value = from;
  config.parameters.assignments.assignments.find((item) => item.name === "FORCE_BACKFILL").value =
    true;
  const windowNode = nodes.find((item) => item.name === "Build Safe Date Window");
  const before = "const today = dateInTimezone(new Date(), timezone);";
  if (!windowNode.parameters.jsCode.includes(before))
    throw new Error("Snap date-window source changed.");
  windowNode.parameters.jsCode = windowNode.parameters.jsCode.replace(
    before,
    `const today = '${to}';`,
  );
  const schedule = nodes.find((item) => item.type === "n8n-nodes-base.scheduleTrigger");
  schedule.parameters.rule.interval = [{ field: "cronExpression", expression: "* * * * *" }];
  const created = await api("/workflows", "POST", {
    name: `TEMP verified Snap backfill ${from} to ${to}`,
    nodes,
    connections: original.connections,
    settings: original.settings,
  });
  await api(`/workflows/${created.id}/activate`, "POST");
  console.log(
    JSON.stringify({ id: created.id, from, to, accounts: ACCOUNTS.length, active: true }),
  );
} else if (command === "stop") {
  if (!from) throw new Error("Use stop WORKFLOW_ID.");
  const workflow = await api(`/workflows/${from}`);
  if (workflow.active) await api(`/workflows/${from}/deactivate`, "POST");
  console.log(JSON.stringify({ id: from, active: false }));
} else if (command === "status") {
  if (!from) throw new Error("Use status WORKFLOW_ID.");
  const executions = await api(`/executions?workflowId=${encodeURIComponent(from)}&limit=5`);
  console.log(
    JSON.stringify(
      (executions.data || []).map((execution) => ({
        id: execution.id,
        status: execution.status,
        startedAt: execution.startedAt,
        stoppedAt: execution.stoppedAt,
      })),
    ),
  );
} else {
  throw new Error("Use fix, start FROM TO, status WORKFLOW_ID, or stop WORKFLOW_ID.");
}
