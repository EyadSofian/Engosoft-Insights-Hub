/** Run a bounded Meta historical import in n8n, bypassing Sheet-based resume. */
const API = "https://n8n.engosoft.com/api/v1";
const SOURCE = "imS2VrWslYHhnFNn";
const key = process.env.N8N_API_KEY;
const [command, from, to, chunkDaysArg] = process.argv.slice(2);
if (!key) throw new Error("N8N_API_KEY is required.");

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

if (command === "start") {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from || "") ||
    !/^\d{4}-\d{2}-\d{2}$/.test(to || "") ||
    from > to ||
    !/^[1-7]$/.test(chunkDaysArg || "3")
  ) {
    throw new Error("Use start YYYY-MM-DD YYYY-MM-DD [chunkDays 1-7].");
  }
  const chunkDays = Number(chunkDaysArg || 3);
  const source = await api(`/workflows/${SOURCE}`);
  const nodes = structuredClone(source.nodes);
  const windowNode = nodes.find((node) => node.name === "Build Safe Date Window");
  if (!windowNode) throw new Error("Meta date-window node missing.");
  let code = windowNode.parameters.jsCode;
  const dateLine = "const today = dateInTimezone(new Date(), timezone);";
  const modeLine = "const isInitialLoad = !state.metaInitialLoadCompleted;";
  const sinceBlock = `const since = isInitialLoad
  ? initialStartDate
  : (rollingStart < initialStartDate ? initialStartDate : rollingStart);`;
  if (![dateLine, modeLine, sinceBlock].every((fragment) => code.includes(fragment))) {
    throw new Error("Meta date-window code changed; aborting clone.");
  }
  code = code
    .replace(dateLine, `const today = '${to}';`)
    .replace(modeLine, "const isInitialLoad = false;")
    .replace(sinceBlock, `const since = '${from}';`);
  windowNode.parameters.jsCode = code;
  const schedule = nodes.find((node) => node.type === "n8n-nodes-base.scheduleTrigger");
  schedule.parameters.rule.interval = [{ field: "cronExpression", expression: "* * * * *" }];
  const config = nodes.find((node) => node.name === "Meta Configuration");
  const chunk = config?.parameters?.assignments?.assignments?.find(
    (item) => item.name === "WORK_CHUNK_DAYS",
  );
  if (!chunk) throw new Error("Meta work chunk configuration missing.");
  chunk.value = chunkDays;
  const created = await api("/workflows", "POST", {
    name: `TEMP verified Meta backfill ${from} to ${to}`,
    nodes,
    connections: source.connections,
    settings: source.settings,
  });
  await api(`/workflows/${created.id}/activate`, "POST");
  console.log(JSON.stringify({ id: created.id, from, to, active: true, chunkDays }));
  // Schedule triggers recur each minute. Deactivate immediately after the first
  // execution begins so a historical load cannot launch overlapping copies.
  let started = false;
  for (let attempt = 0; attempt < 45; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const [running, finished] = await Promise.all([
      api(`/executions?workflowId=${created.id}&status=running&limit=1`),
      api(`/executions?workflowId=${created.id}&limit=1`),
    ]);
    const execution = running.data?.[0] || finished.data?.[0];
    if (!execution) continue;
    await api(`/workflows/${created.id}/deactivate`, "POST");
    console.log(JSON.stringify({ id: created.id, active: false, executionId: execution.id }));
    started = true;
    break;
  }
  if (!started) {
    await api(`/workflows/${created.id}/deactivate`, "POST");
    throw new Error(`Historical workflow ${created.id} never started.`);
  }
} else if (command === "status") {
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
} else if (command === "stop") {
  const workflow = await api(`/workflows/${from}`);
  if (workflow.active) await api(`/workflows/${from}/deactivate`, "POST");
  console.log(JSON.stringify({ id: from, active: false }));
} else {
  throw new Error("Use start FROM TO, status WORKFLOW_ID, or stop WORKFLOW_ID.");
}
