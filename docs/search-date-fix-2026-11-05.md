# Creative search and date scope — 2026-11-05

## Reproduced cause

- The UI sent `range=all`, while `/api/acquisition/closed-loop` discarded it.
- Both the default request and `?range=all` returned 2026-11-01 → 2026-11-05 in production.
- The acquisition page displayed “Month to date” whenever explicit from/to were absent, including All time.
- Stored Meta daily facts contain `PMP-Ad1-20-July 25`: first stored day 2026-03-09, last stored day 2026-10-25 (365 account/ad/day rows). The name is not evidence of its creation date.
- Literal table substring matching also failed on separator/spacing variations.

## Changes

- Preserve the explicit date scope in the closed-loop, performance and creative-detail API routes.
- Resolve All time from the earliest available acquisition or stored dataset date through the current Cairo day; cache the bounds for 60 seconds. Do not silently fall back to this month on a database failure.
- Keep custom and default month-to-date ranges unchanged.
- Display All time / كل الفترات consistently in page headers.
- Normalize table searches for case, punctuation, Arabic/Persian digits, and letter/digit spacing. All entered terms are required; short numeric terms must match a token, so Ad2 does not match a date containing 20.
- Preserve displayed names, grouping keys and metric calculations.
- Show the selected search scope, a clear button and an explicit user-controlled action to search all available periods without losing the query.

## Scope

This patch is independent of the previously uncommitted Lost/validation changes. No Google Sheet, Odoo record, ad or campaign is edited.
