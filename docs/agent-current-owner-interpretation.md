# Current-owner evidence contract

The current Odoo salesperson field is not an assignment log. A blank owner must
never be reported as "never assigned", "never contacted" or "lost because no one
called". Lost duplicate records often have no current owner.

Read `ownershipAudit` in `/api/leads`, `/api/teams`, `/api/overview` or
`/api/lead-performance?month=YYYY-MM`. The first three follow the API's reporting
filters; performance follows its selected entry month and course. Do not join
those scopes without checking them.

The audit partitions missing-current-owner records into recorded-duplicate Lost,
other Lost, open/active Leads and Won. These are disjoint status categories, not
phone-identity deduplication. Recorded duplicate reasons remain in the original
source populations; this change does not silently delete records or redefine
acquisition KPIs.

`neverAssigned`, `neverContacted` and `lostBecauseUnassigned` are deliberately
null: neither a blank salesperson nor a Lost stage proves these claims. Read
explicit Yeastar/Chatwoot/Chatter evidence with its coverage and period for
contact questions. Do not equate "no evidence available" with "no call happened".
Unowned active records can be reviewed operationally but are not automatically
untouched leads.

The agent surface gateway projects this audit and the bilingual interpretation
caveat. MCP `insights_get` includes the audit and interpretation outside the
data slice, even when reading only a nested row/page. MCP initialization and
tool descriptions carry the same constraints. External MCP adapters must preserve these fields and caveats rather than
summarize an ownerless bucket as an unassigned work queue. An external agent that
reads a cached/raw schema should refresh its tool schema/data; its separately
hosted prompt, if any, is not managed by this repository.

Do not infer lead quality, individual blame, or a promised gain from redistribution
from aggregate conversion rankings. Compare like-for-like creation cohorts,
follow-up age, source/course mix, duplicate policy and contact coverage. Target
attainment is not a cohort conversion rate.

Management review now follows the shared top-bar dates through `useApi` and
`parseFilters`, including partial- and multi-month windows. `selectedPeriod` is
the exact effective date window; explicit dates override a legacy `month` query.
Revenue remains Accounting collections by payment date, not an invoice-date
valuation. The saved full monthly media-plan targets are not employee quotas
and are not day-prorated. Targets for a dimension without a saved allocation
remain null. Multi-month rates are recalculated from summed counts rather than
averaged percentages. The review has no independent month selector; selecting
a month row updates the shared date filter.
