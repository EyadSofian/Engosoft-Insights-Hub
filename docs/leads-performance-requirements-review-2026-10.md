# Six-month lead-to-paid report: requirement audit

Reviewed 2026-10-25. Page: `/leads?view=performance`. The six cohorts are calendar entry months; the current month is partial. Recommendation and WhatsApp Broadcast records are excluded by the shared acquisition source/segment policy. An em dash means evidence is unavailable, not zero.

| Requested measure | Current state | Evidence and limitation |
|---|---|---|
| Monthly incoming leads by course, source, campaign, media buyer | Available as **new CRM records**, not verified historical Fresh | Monthly selector and dimension table. Media buyer is campaign/course-rule attribution; unassigned records remain visible. Odoo `Lead Segment` is a **current classification field separate from opportunity Stage**. A blank segment does not mean no sales stage. The report shows current Fresh-tagged and blank-segment counts separately. |
| Duplicates, same or cross-month | Available as a review signal | Repeated normalized phone/email identity, split by same/earlier month. Odoo Duplicate loss reason is separate. A match is not automatic proof that either registration should be removed. |
| Unqualified and why | Partially available | Odoo Not Qualified loss reason and manual QA verdicts where submitted. Customer-data/course-fit reasons require an explicit reason. A cohort with no QA reviews is labeled incomplete, not fully qualified. |
| No Answer, Unreachable, No Interest, Lost by cohort/course/source | Available for current Lost records | Reasons are subsets of Lost and never added to it. Current status/reason is used; it is not a historical month-end snapshot. |
| Contact attempts per lead, 0/1/2/3+, average and time to first | Available from Yeastar when daily CDR coverage is complete | Selected-month record table, aggregate cards and all dimension breakdowns. Shared phone identities are not assigned a call by guesswork. Zero PBX calls does not prove no WhatsApp/Chatter contact. Exact-hour lag requires an exact Odoo creation timestamp; otherwise the day-level estimate is marked. |
| Fresh leads to actual paid enrollments and conversion | **Lower bound only** | Positive net paid invoices (after credit notes) on an exact sale order → opportunity link, attributed to the record's entry month. CRM Won alone is never counted. The denominator is all eligible new CRM records, not a historically proven Fresh population. Unlinked paid invoices are shown in the audit but not guessed onto leads. |
| Paid registrations and USD by course/source/campaign/buyer/closer | Available for exact-linked portion | Selected-month dimension table and workbook. Closer follows the paid accounting line's salesperson; cannot substitute for a missing lead link. |
| Sales in a later month credited to original lead cohort | Available for exact-linked portion | `Paid later` belongs to the original entry cohort. Payment-month invoices and cash are displayed separately. |
| Funnel stage counts and transitions | Partial | Entry and exact-paid counts are evidenced; PBX contact rate uses phone-matchable denominator. Opportunity is **current status**, not logged prior transitions. Historical stage-to-stage rates are withheld until transition events exist. |
| Six-month comparison and lead-level audit | Available | Six-month comparison strip/table; searchable selected-month record table with Odoo links; Excel includes months, dimensions, funnel, reasons, records and limitations. |

## What data is still required for a complete evaluation

1. Immutable Lead Segment/Fresh classification at creation, or an Odoo event history from which the initial class can be reconstructed. Current `Lead Segment` does not answer what the field was at entry.
2. Consistent manual QA verdicts and reason codes on sampled/failed leads, especially to distinguish invalid customer details from poor course fit.
3. Opportunity stage-transition timestamps if management needs actual conversion rate from one sales stage to the next or stage aging in month 1/month 2.
4. `sale.order.opportunity_id` (or another audited lead key) on sales orders currently missing it. An invoice's seller identifies the seller, not the originating lead, source, campaign or media buyer.
5. A bulk, attributable Chatter/WhatsApp event feed if all contact attempts—not just Yeastar PBX—must be scored. Until then, the outreach measure is explicitly PBX-only.

The page and workbook expose the limits next to the numbers. They must not be removed merely to produce a single headline conversion rate.
