# Chatwoot analytics architecture

## Decision

The employee dashboard has two deliberately separate read paths:

1. **Dashboard aggregate (bounded and synchronous)**
   - Period totals and response-time averages come from Chatwoot agent summary reports.
   - Current open, unattended, and unassigned workload comes from Chatwoot conversation metrics.
   - The number of HTTP calls is constant and does not grow with conversation history.
2. **Employee evidence (filtered and on demand)**
   - Opening an employee's evidence drawer calls Chatwoot's conversation filter endpoint.
   - Chatwoot filters by agent and last-activity range before pagination.
   - The application loads only enough 25-row pages to fill the visible limit.

The aggregate path must never enumerate `/conversations` pages. On this account,
that would make a normal dashboard request scan a six-figure conversation history.

## Metric semantics

- `conversations`, `resolved`, and response-time averages describe the selected period.
- `openConversations`, `awaitingReply` (Chatwoot `unattended`), and `unassigned`
  describe the live workload now.
- `open` is not renamed or treated as `unread`.
- Missing unread data remains `null`; it is not converted to zero and cannot earn
  unread-related employee-score points.

## Target production architecture

The report endpoints are the correct immediate read model. For durable historical
workload, auditability, and near-real-time alerts, add this asynchronous path:

```text
Chatwoot webhook
      |
      v
signature validation -> idempotent event inbox (PostgreSQL)
      |                         |
      |                         +-> raw payload + processing status + retry count
      v
conversation projector -> conversation_state + conversation_events
      |
      +-> employee_daily_chat_metrics
      |
      +-> dashboard API / alerts / training exports
```

Recommended tables:

- `chatwoot_event_inbox(event_key, event_type, occurred_at, payload, status, attempts)`
- `chatwoot_conversation_state(conversation_id, assignee_id, status, waiting_since, last_activity_at, updated_at)`
- `chatwoot_conversation_events(conversation_id, event_type, occurred_at, assignee_id, payload)`
- `employee_daily_chat_metrics(day, agent_id, conversations, first_replies, unattended_seconds, messages)`

Use a unique event key and an upsert so webhook retries are harmless. Process the
inbox asynchronously, retain the raw event for replay, and rebuild projections when
metric definitions change. PostgreSQL remains the source for dashboard history;
Chatwoot remains the source for deep links and on-demand conversation detail.

## Operational rules

- Return the independent Odoo and Calls Hub sections even if Chatwoot fails.
- Show the real upstream error; do not call a timeout "not configured".
- Cache bounded report snapshots briefly (currently 60 seconds).
- Put request timeouts on every upstream call and record latency/error metrics.
- Keep API tokens server-side and rotate any token exposed outside the secret store.
- Add a nightly reconciliation job comparing projected daily totals with Chatwoot
  reports, and surface any mismatch before it affects employee scoring.
