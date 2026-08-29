# Engosoft employee intelligence architecture

## System boundaries

Each platform remains authoritative for its own domain:

| Domain                                                     | Source of truth     | Stored in the analytics platform                                      |
| ---------------------------------------------------------- | ------------------- | --------------------------------------------------------------------- |
| Leads, assignment, course, opportunities, orders, payments | Odoo                | Normalized ids, daily facts, source deep links                        |
| Calls, extensions, recordings                              | Yeastar / Calls Hub | Call metadata, transcript, versioned evaluation, recording object key |
| Chats, assignees, messages, response state                 | Chatwoot            | Event inbox, current projection, daily aggregates, source deep links  |
| Recordings and large exports                               | Object storage      | Object key and metadata only; never audio blobs in PostgreSQL         |

Insights Hub is the read and decision layer. It must not become a second CRM or
silently invent a value when an upstream source does not expose one.

## Recommended flow

```text
Odoo webhooks/poll   Yeastar/Calls events   Chatwoot webhooks
        \                  |                  /
         +------ authenticated event inbox -+
                            |
                   idempotent processors
                            |
          +-----------------+------------------+
          |                 |                  |
   identity mapping   domain fact tables   AI jobs/results
          |                 |                  |
          +---------- materialized read models+
                            |
                  Insights Hub API/BFF
                            |
            team dashboard + employee profile
```

## Core engineering rules

1. **Canonical identity:** maintain explicit mappings for Odoo user id, Yeastar
   extension, Chatwoot agent id, and employee id. Name matching is only a review
   queue, never the permanent key.
2. **Canonical customer:** normalize the phone to E.164 and retain the original.
   Store source contact/lead ids so one phone can still have multiple leads.
3. **Idempotent ingestion:** every webhook enters an inbox with a unique source
   event id. Retries update the same row rather than duplicating facts.
4. **Fast read models:** dashboards read pre-aggregated employee/day rows. Source
   APIs are used for reconciliation and evidence drill-down, not full scans.
5. **Evidence-first scoring:** every score stores its rubric version, model
   version, transcript version, evidence spans, deductions, reviewer state, and
   final approved score. A model output is a proposal until reviewed.
6. **Asynchronous AI:** transcription, correction, and scoring are separate jobs
   with status, attempts, cost, model, and timestamps. The web request only
   enqueues work and reads the last completed result.
7. **Replayability:** retain raw events and immutable model inputs so projections
   and scores can be rebuilt after a rule change.
8. **Observable failure:** show source freshness and the real error per integration;
   never turn a timeout into "not configured" and never blank healthy sections.

## Delivery sequence

1. Use bounded source reports and filtered evidence calls (implemented now for Chatwoot).
2. Add explicit employee/contact identity tables and an admin review screen for unmatched ids.
3. Add webhook inboxes and PostgreSQL projectors for Chatwoot, Yeastar, and Odoo.
4. Move dashboard totals to daily materialized facts and add nightly reconciliation.
5. Version the QA rubric and reviewer corrections; export approved examples as the
   training dataset only after inter-reviewer agreement is measured.
