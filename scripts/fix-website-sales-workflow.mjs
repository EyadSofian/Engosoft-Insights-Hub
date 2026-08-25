#!/usr/bin/env node

/**
 * Patch the production Website Sales workflow so an Odoo sale is included when
 * either:
 *   1. sale.order.website_id is the Engosoft website, or
 *   2. sale.order.source_id is the Website UTM source.
 *
 * Odoo orders created by the sales team can carry Source=Website while their
 * website_id is blank. Reading only website_id made those confirmed orders
 * disappear from the Website Sales snapshot.
 *
 * Usage:
 *   N8N_API_KEY=... node scripts/fix-website-sales-workflow.mjs
 */

const apiBase = (process.env.N8N_API_BASE || "https://n8n.engosoft.com/api/v1").replace(/\/+$/, "");
const workflowId = process.env.N8N_WEBSITE_WORKFLOW_ID || "eBR8GvExlKBCeLxU";
const apiKey = process.env.N8N_API_KEY?.trim();

if (!apiKey) throw new Error("N8N_API_KEY is required.");

const headers = {
  "content-type": "application/json",
  "X-N8N-API-KEY": apiKey,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const request = async (path, init = {}) => {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fetch(`${apiBase}${path}`, {
        headers,
        ...init,
        signal: AbortSignal.timeout(45_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 5) await wait(attempt * 2_000);
    }
  }
  throw lastError;
};

const get = async (path) => {
  const response = await request(path);
  if (!response.ok) throw new Error(`n8n GET ${path} failed with ${response.status}`);
  return response.json();
};

const put = async (path, body) => {
  const response = await request(path, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`n8n PUT ${path} failed with ${response.status}: ${detail.slice(0, 300)}`);
  }
  return response.json();
};

const clone = (value) => JSON.parse(JSON.stringify(value));
const workflow = await get(`/workflows/${workflowId}`);
const nodes = clone(workflow.nodes);
const connections = clone(workflow.connections);

const byName = (name) => {
  const node = nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Required node not found: ${name}`);
  return node;
};

const originalOrders = byName("Read All Engosoft Website Sales Orders");
const runtimeConfiguration = byName("Runtime Configuration");
const lineRequest = byName("Build Website Order Line Request");
const opportunityRequest = byName("Build Opportunity Request");
const invoiceRequest = byName("Build Invoice Request");
const buildSnapshot = byName("Build Reconciled Website Sales Snapshot");
const verifyIngest = byName("Verify Website Sales Ingest");

const nodeNames = {
  prepare: "Prepare Website Source Lookup",
  sources: "Read Odoo UTM Sources",
  select: "Select Website UTM Source",
  sourceOrders: "Read Website-Source Sales Orders",
  merge: "Merge Website Order Sources",
};

const alreadyPatched = nodes.some((node) => node.name === nodeNames.merge);
if (!alreadyPatched) {
  for (const node of nodes) {
    if (Array.isArray(node.position) && Number(node.position[0]) >= 1200) {
      node.position[0] += 1200;
    }
  }
}

const upsertNode = (node) => {
  const index = nodes.findIndex((entry) => entry.name === node.name);
  if (index === -1) nodes.push(node);
  else nodes[index] = { ...nodes[index], ...node };
};

const codeNode = (id, name, position, jsCode) => ({
  id,
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  parameters: { jsCode },
});

upsertNode(
  codeNode(
    "b7ec1590-8a84-4c38-8a62-7fc837851bf0",
    nodeNames.prepare,
    [1200, 0],
    "return [{ json: $('Select Engosoft Website').first().json }];",
  ),
);

upsertNode({
  id: "12be802d-5905-4c4b-a6bd-6931dd3af18a",
  name: nodeNames.sources,
  type: originalOrders.type,
  typeVersion: originalOrders.typeVersion,
  position: [1440, 0],
  credentials: clone(originalOrders.credentials),
  parameters: {
    resource: "custom",
    customResource: "utm.source",
    operation: "getAll",
    returnAll: true,
    options: { fieldsList: ["id", "name"] },
  },
});

upsertNode(
  codeNode(
    "dfc8e4a3-8edb-48e8-a00d-741d0ef91824",
    nodeNames.select,
    [1680, 0],
    `const config = $('Select Engosoft Website').first().json;
const normalize = (value) => String(value || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '').trim().toLowerCase();
const sources = $input.all().map((item) => item.json || {}).filter((row) => row.id);
const exact = sources.filter((row) => normalize(row.name) === 'website');
const matches = exact.length ? exact : sources.filter((row) => normalize(row.name).includes('website'));
if (!matches.length) throw new Error('Odoo UTM Source named Website was not found. PostgreSQL was NOT replaced.');
return [{ json: { ...config, websiteSourceIds: [...new Set(matches.map((row) => Number(row.id)).filter(Boolean))], websiteSourceNames: matches.map((row) => row.name) } }];`,
  ),
);

upsertNode({
  id: "f5de65bf-0dc4-4a43-b743-78de8b61464d",
  name: nodeNames.sourceOrders,
  type: originalOrders.type,
  typeVersion: originalOrders.typeVersion,
  position: [1920, 0],
  credentials: clone(originalOrders.credentials),
  parameters: {
    resource: "custom",
    customResource: "sale.order",
    operation: "getAll",
    returnAll: true,
    options: clone(originalOrders.parameters.options),
    filterRequest: {
      filter: [
        {
          fieldName: "date_order",
          operator: "greaterOrEqual",
          value: '={{ $json.startDate + " 00:00:00" }}',
        },
        {
          fieldName: "source_id",
          operator: "in",
          value: "={{ $json.websiteSourceIds }}",
        },
        { fieldName: "state", value: "sale" },
      ],
    },
  },
});

upsertNode(
  codeNode(
    "f81ac6b3-0301-4ddd-b1ef-864684091ac4",
    nodeNames.merge,
    [2160, 0],
    `const byId = new Map();
for (const nodeName of ['Read All Engosoft Website Sales Orders', 'Read Website-Source Sales Orders']) {
  for (const item of $(nodeName).all()) {
    const row = item.json || {};
    if (row.id && row.state === 'sale') byId.set(Number(row.id), row);
  }
}
const orders = [...byId.values()];
if (orders.length < 40) throw new Error('Odoo Website Sales union unexpectedly small: orders=' + orders.length + '. PostgreSQL was NOT replaced.');
return orders.map((row) => ({ json: row }));`,
  ),
);

const replacePopulationReference = (node) => {
  node.parameters.jsCode = String(node.parameters.jsCode).replaceAll(
    "$('Read All Engosoft Website Sales Orders').all()",
    "$('Merge Website Order Sources').all()",
  );
};
replacePopulationReference(opportunityRequest);
replacePopulationReference(invoiceRequest);
replacePopulationReference(buildSnapshot);

runtimeConfiguration.parameters.jsCode = String(runtimeConfiguration.parameters.jsCode).replace(
  "orderFields: ['id','name'",
  "orderFields: ['id','name','source_id'",
);

buildSnapshot.parameters.jsCode = String(buildSnapshot.parameters.jsCode)
  .replace(
    "const orders = $('Merge Website Order Sources').all().map((item) => item.json || {}).filter((row) => row.id && row.state === 'sale');",
    "const orders = $('Merge Website Order Sources').all().map((item) => item.json || {}).filter((row) => row.id && row.state === 'sale');\nconst websiteSourceOrderIds = new Set($('Read Website-Source Sales Orders').all().map((item) => Number(item.json?.id)).filter(Boolean));",
  )
  .replace(
    "'Website': display(order.website_id)",
    "'Website': display(order.website_id) || (websiteSourceOrderIds.has(Number(order.id)) ? 'Engosoft' : '')",
  )
  .replace(
    "'Opportunity Source': display(lead.source_id)",
    "'Opportunity Source': display(order.source_id) || display(lead.source_id)",
  )
  .replace(
    "source:'Odoo website sales + approved external Website Sales source via n8n'",
    "source:'Odoo website_id=Engosoft OR Source=Website + approved external Website Sales source via n8n'",
  )
  .replace(
    "odooOrders:orders.length, odooLines:lines.length",
    "odooOrders:orders.length, odooWebsiteIdOrders:$('Read All Engosoft Website Sales Orders').all().length, odooWebsiteSourceOrders:$('Read Website-Source Sales Orders').all().length, odooLines:lines.length",
  )
  .replace(
    "reconciliationBasis:'Order ID'",
    "odooPopulationRule:'website_id=Engosoft OR source_id=Website', reconciliationBasis:'Order ID'",
  )
  // `replacePopulationReference` deliberately changes the main order reader,
  // but the diagnostic must continue to count the website_id branch itself.
  .replace(
    "odooWebsiteIdOrders:$('Merge Website Order Sources').all().length",
    "odooWebsiteIdOrders:$('Read All Engosoft Website Sales Orders').all().length",
  );

verifyIngest.parameters.jsCode = String(verifyIngest.parameters.jsCode).replace(
  "odooOrders:prepared.metadata.odooOrders, externalOrders:prepared.metadata.externalOrders",
  "odooOrders:prepared.metadata.odooOrders, odooWebsiteIdOrders:prepared.metadata.odooWebsiteIdOrders, odooWebsiteSourceOrders:prepared.metadata.odooWebsiteSourceOrders, externalOrders:prepared.metadata.externalOrders",
);

const connect = (from, to) => {
  connections[from] = { main: [[{ node: to, type: "main", index: 0 }]] };
};
connect("Read All Engosoft Website Sales Orders", nodeNames.prepare);
connect(nodeNames.prepare, nodeNames.sources);
connect(nodeNames.sources, nodeNames.select);
connect(nodeNames.select, nodeNames.sourceOrders);
connect(nodeNames.sourceOrders, nodeNames.merge);
connect(nodeNames.merge, "Build Website Order Line Request");

// Keep the original guard; it now checks the deduplicated union passed in from
// Merge Website Order Sources rather than the website_id-only branch.
lineRequest.parameters.jsCode = String(lineRequest.parameters.jsCode).replace(
  "Odoo Website Sales snapshot unexpectedly small",
  "Odoo Website Sales union unexpectedly small",
);

const result = await put(`/workflows/${workflowId}`, {
  name: "Engosoft — Website Sales → Railway PostgreSQL [v2]",
  nodes,
  connections,
  settings: workflow.settings,
});

console.log(
  JSON.stringify({
    id: result.id,
    name: result.name,
    active: result.active,
    updatedAt: result.updatedAt,
    populationRule: "website_id=Engosoft OR source_id=Website",
    nodes: result.nodes?.length,
  }),
);
