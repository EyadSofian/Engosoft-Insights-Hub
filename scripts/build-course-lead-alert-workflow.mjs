const APP_URL = "https://engosoft-insights-hub-production.up.railway.app";

const prepareEmailCode = `const report = $input.first().json;
const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const money = (value) => value == null || !Number.isFinite(Number(value))
  ? '—'
  : '$' + Number(value).toLocaleString('en-US', { maximumFractionDigits: 2 });
const alerts = (report.rows || []).filter((row) => row.status !== 'stable');
const reason = (row) => {
  const parts = [];
  if (row.issues.includes('lead_drop')) parts.push('هبوط الليدز');
  if (row.issues.includes('cpl_spike')) parts.push('ارتفاع CPL');
  if (row.issues.includes('spend_without_leads')) parts.push('صرف بدون ليدز');
  return parts.join(' · ');
};
const rows = alerts.map((row) => \`<tr>
  <td style="padding:12px;border-bottom:1px solid #e5eaf2;font-weight:700">\${escapeHtml(row.course)}</td>
  <td style="padding:12px;border-bottom:1px solid #e5eaf2;text-align:center">\${row.current.leads}</td>
  <td style="padding:12px;border-bottom:1px solid #e5eaf2;text-align:center">\${Number(row.baseline.leadsPerDay).toFixed(1)}</td>
  <td style="padding:12px;border-bottom:1px solid #e5eaf2;text-align:center;color:#b42318;font-weight:700">\${row.leadDeltaPct == null ? '—' : Number(row.leadDeltaPct).toFixed(0) + '%'}</td>
  <td style="padding:12px;border-bottom:1px solid #e5eaf2;text-align:center">\${money(row.current.cpl)}</td>
  <td style="padding:12px;border-bottom:1px solid #e5eaf2">\${escapeHtml(reason(row))}</td>
</tr>\`).join('');
const html = \`<!doctype html><html dir="rtl" lang="ar"><body style="margin:0;background:#f5f7fb;font-family:Arial,Tahoma,sans-serif;color:#10233f">
  <div style="max-width:900px;margin:24px auto;background:#fff;border:1px solid #dbe3ef;border-radius:16px;overflow:hidden">
    <div style="padding:22px 24px;background:#102f5c;color:#fff">
      <div style="font-size:13px;opacity:.75">ENGOSOFT INSIGHTS</div>
      <h1 style="margin:7px 0 4px;font-size:24px">تنبيه تغيّر أداء الدورات</h1>
      <div style="font-size:14px;opacity:.86">يوم \${escapeHtml(report.anchorDate)} · مقارنة بنفس يوم الأسبوع خلال \${report.baselineWeeks} أسابيع</div>
    </div>
    <div style="padding:20px 24px">
      <div style="display:inline-block;padding:7px 12px;border-radius:999px;background:#fff1f0;color:#b42318;font-weight:700">\${alerts.length} دورة تحتاج مراجعة</div>
      <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:13px">
        <thead><tr style="background:#f2f5fa;color:#52647d">
          <th style="padding:11px;text-align:right">الدورة</th><th style="padding:11px">ليدز اليوم</th><th style="padding:11px">المتوقع</th><th style="padding:11px">التغيّر</th><th style="padding:11px">CPL</th><th style="padding:11px;text-align:right">سبب التنبيه</th>
        </tr></thead><tbody>\${rows}</tbody>
      </table>
      <a href="${APP_URL}/courses#daily-lead-monitor" style="display:inline-block;margin-top:20px;padding:11px 18px;border-radius:10px;background:#1762aa;color:#fff;text-decoration:none;font-weight:700">فتح التفاصيل في الداشبورد</a>
      <p style="margin:18px 0 0;color:#6b7c93;font-size:12px;line-height:1.8">لا يتم الإرسال عند التغيّرات الصغيرة أو عند تأخر أحد مصادر البيانات. الحد الأدنى: متوسط 3 ليدز يوميًا لهبوط الحجم، وارتفاع CPL بنسبة 30% على الأقل مع حجم عينة كافٍ.</p>
    </div>
  </div>
</body></html>\`;
return [{ json: {
  ...report,
  toEmail: $('Configuration').first().json.MANAGER_EMAIL,
  ccEmail: $('Configuration').first().json.CC_EMAIL,
  subject: \`🚨 تنبيه أداء الدورات — \${alerts.length} دورة — \${report.anchorDate}\`,
  html,
} }];`;

const workflow = {
  name: "Engosoft — Daily Course Lead Anomaly Alerts",
  nodes: [
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1001",
      name: "Daily 10 AM Cairo",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 0],
      parameters: {
        rule: { interval: [{ field: "cronExpression", expression: "0 10 * * *" }] },
      },
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1002",
      name: "Manual Test",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 150],
      parameters: {},
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1003",
      name: "Configuration",
      type: "n8n-nodes-base.set",
      typeVersion: 3.4,
      position: [224, 70],
      parameters: {
        assignments: {
          assignments: [
            {
              id: "course-alert-app-url",
              name: "APP_URL",
              value: APP_URL,
              type: "string",
            },
            {
              id: "course-alert-manager",
              name: "MANAGER_EMAIL",
              value: "tech.team.leader2@engosoft.com",
              type: "string",
            },
            {
              id: "course-alert-cc",
              name: "CC_EMAIL",
              value: "eyad.sofiane@engosoft.com",
              type: "string",
            },
          ],
        },
        options: {},
      },
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1004",
      name: "Fetch Course Lead Signals",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [448, 70],
      parameters: {
        method: "GET",
        url: "={{ $json.APP_URL + '/api/course-lead-alerts' }}",
        options: { timeout: 120000 },
      },
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 10000,
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1005",
      name: "Has Material Alerts",
      type: "n8n-nodes-base.if",
      typeVersion: 2.1,
      position: [672, 70],
      parameters: {
        conditions: {
          options: { caseSensitive: true, typeValidation: "strict", version: 1 },
          conditions: [
            {
              id: "course-alert-count",
              leftValue: "={{ $json.summary.alertCount }}",
              rightValue: 0,
              operator: { type: "number", operation: "gt" },
            },
            {
              id: "course-alert-fresh",
              leftValue: "={{ $json.freshness.ok }}",
              rightValue: true,
              operator: { type: "boolean", operation: "equals" },
            },
          ],
          combinator: "and",
        },
        options: {},
      },
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1006",
      name: "Build Arabic Alert Email",
      type: "n8n-nodes-base.code",
      typeVersion: 2,
      position: [896, -30],
      parameters: { jsCode: prepareEmailCode },
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1007",
      name: "Email Management Alert",
      type: "n8n-nodes-base.emailSend",
      typeVersion: 2.1,
      position: [1120, -90],
      credentials: {
        smtp: { id: "4SQaiwv91DfZPYpF", name: "SMTP account" },
      },
      parameters: {
        fromEmail: "eyad.sofiane@engosoft.com",
        toEmail: "={{ $json.toEmail }}",
        ccEmail: "={{ $json.ccEmail }}",
        subject: "={{ $json.subject }}",
        html: "={{ $json.html }}",
        options: {},
      },
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1008",
      name: "Send Telegram Notification",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4.2,
      position: [1120, 40],
      parameters: {
        method: "POST",
        url: `${APP_URL}/api/telegram/send-course-alerts?once=1`,
        sendBody: false,
        options: { timeout: 120000 },
      },
      retryOnFail: true,
      maxTries: 2,
      waitBetweenTries: 10000,
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1009",
      name: "No Alert Today",
      type: "n8n-nodes-base.noOp",
      typeVersion: 1,
      position: [896, 170],
      parameters: {},
    },
    {
      id: "db52fa60-9cc5-4d65-9f1d-eadfe03a1010",
      name: "Alert Rules",
      type: "n8n-nodes-base.stickyNote",
      typeVersion: 1,
      position: [420, -270],
      parameters: {
        width: 760,
        height: 210,
        content:
          "## Course lead anomaly monitor\n- Runs at 10:00 Africa/Cairo after the previous day is complete.\n- Compares each course with the same weekday across 8 prior weeks.\n- Alerts only for a material lead drop, a CPL increase of at least 30%, or spend with zero leads.\n- Stale cross-source data pauses alerts instead of producing false accusations.\n- Dashboard API is the single source for the UI, email, and Telegram notification.",
      },
    },
  ],
  connections: {
    "Daily 10 AM Cairo": {
      main: [[{ node: "Configuration", type: "main", index: 0 }]],
    },
    "Manual Test": {
      main: [[{ node: "Configuration", type: "main", index: 0 }]],
    },
    Configuration: {
      main: [[{ node: "Fetch Course Lead Signals", type: "main", index: 0 }]],
    },
    "Fetch Course Lead Signals": {
      main: [[{ node: "Has Material Alerts", type: "main", index: 0 }]],
    },
    "Has Material Alerts": {
      main: [
        [{ node: "Build Arabic Alert Email", type: "main", index: 0 }],
        [{ node: "No Alert Today", type: "main", index: 0 }],
      ],
    },
    "Build Arabic Alert Email": {
      main: [
        [
          { node: "Email Management Alert", type: "main", index: 0 },
          { node: "Send Telegram Notification", type: "main", index: 0 },
        ],
      ],
    },
  },
  pinData: {},
  active: true,
  settings: {
    executionOrder: "v1",
    timezone: "Africa/Cairo",
    binaryMode: "separate",
    availableInMCP: false,
  },
  meta: {
    templateCredsSetupCompleted: true,
    instanceId: "1c87d2e4d71b0347b7a466f90732115fba3103f4ac8b4665dc4e98ed83bfb402",
  },
  tags: [],
};

export { workflow };

if (typeof process !== "undefined" && process?.stdout?.write) {
  process.stdout.write(`${JSON.stringify(workflow, null, 2)}\n`);
}
