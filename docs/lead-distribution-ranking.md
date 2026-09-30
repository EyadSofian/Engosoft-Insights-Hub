# Monthly lead distribution ranking

The **Team → Lead distribution** report (`/lead-distribution`) ranks employees
within a specialization code (Mech, BIM, PMP, etc.) and within its exact course
products. This first phase provides the evidence for allocation; it does not
write assignments to Odoo.

## Window and metrics

Select a distribution month. October 2026 uses **April 1–September 30, 2026**.
The default is the next calendar month in Africa/Cairo. Global date, employee,
campaign and ad filters do not affect this report or its peer benchmarks.

The score is:

```
50 × max(0, net paid USD) / highest positive net paid USD
+ 25 × distinct paid invoices / highest distinct paid invoice count
+ 25 × conversion rate / highest conversion rate
```

Each maximum belongs to the same specialization/course population. A zero
maximum contributes zero points. Scores stay between 0 and 100; equal scores
share a competition rank (1, 1, 3). Small lead samples are labelled, without
silently adding a fourth ranking factor or changing the approved weights.

- **Revenue:** authoritative Accounting `usdPaid`, by Payment Date, following
  existing FX/revenue exclusions. Credit notes reduce revenue on their reversal
  Invoice Date. Collected revenue can come from leads created before this window.
- **Invoices:** distinct `(company, movement)` per employee and scope, excluding
  credit notes. Multiple product lines never multiply the specialty invoice
  count. An invoice spanning courses can count once in each course; those course
  counts must not be added to reconstruct the specialty count.
- **Conversion:** distinct cohort leads currently Won with `wonDate` (falling
  back to `closedAt`) on/before the cutoff, divided by all distinct leads created
  in the six-month window, including Lost. Invoice count is not its numerator.
- **Employee identity:** explicit Odoo user/HR spellings merge under a stable
  user identity; ambiguous names retain separate source identities.
- **Course identity:** exact catalogue product labels, including product codes,
  matched against the CRM `Courses` list. No fuzzy inference from specialty to
  product. Discounts/fees remain in specialty totals and do not create courses.

## Sources and limitations

`GET /api/lead-ranking?month=2026-10` reads the complete server-side snapshot via
`getFiltered` and the existing Odoo employee directory. It prefers the same live
Lost Lead / Lost Opportunity population as `/api/leads`, preserving the exact
`Courses` product labels. Last-good canonical Odoo Lost snapshots remain an
explicit fallback. Source authority is visible in the calculation disclosure.

The endpoint is covered by existing dashboard read authentication. No API key
is placed in browser code, responses or repository files. The projection for
ENGO Nexus contains only employee ranking facts and the selected month; no
customer contact fields are exposed by this endpoint.

Missing Lost evidence, missing conversion denominators, undated Won records,
or missing invoice keys prevent a complete affected score. Missing lead IDs
prevent complete ranks for the response because the omitted denominator cannot
be audited. Unassigned/unclassified facts and months without source records are
reported explicitly. A month with no activity is not proof that ingestion failed.

Ownership, specialization and current state come from the available records,
not a historical reassignment/event ledger. Therefore a past month's result can
change after reassignment or correction. This phase does not persist/freeze
approved allocation snapshots. Leads without exact course labels remain in the
specialty denominator; course conversion covers only explicitly matched leads.

## Verification

Unit/API/component tests cover window boundaries, normalization, shared ranks,
duplicate lines/lead IDs, credit notes, unavailable evidence, exact course
matching, source coverage, global-filter isolation and Arabic presentation.

For a read-only comparison against the deployed dashboard:

```sh
node --experimental-strip-types scripts/audit-lead-ranking.mjs 2026-10
```

The audit recursively splits date ranges until every API detail response is
untruncated, verifies interval counts, and refuses inconsistent results. It
writes employee ranking facts to ignored `.data/lead-ranking-2026-10.json`.
It discards customer contact fields. The public Lost detail lacks exact product
labels, so this audit verifies specialty results; course denominators and HR
identity merges require the native server-side source.

The September 30, 2026 audit read 21,140 lead records and 6,777 Accounting lines
from the published APIs. Counts are a point-in-time verification, not static
values used by the report.
