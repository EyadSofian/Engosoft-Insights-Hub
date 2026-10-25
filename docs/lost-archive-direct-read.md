# Lost Archive: direct read-only connection

The `جودة الليدز واللوست` tab reads the private Lost Archive Google Sheet directly from the dashboard server via Google Sheets API `values:batchGet`. It reads only the three primary tabs (`Aug`, `Sep`, `Oct`); their Validation counterparts repeat `Validate=No` rows and are deliberately excluded. Data is aggregated in memory, cached for five minutes, and never posted to the ingestion endpoint or stored in PostgreSQL. The API returns aggregate counts, not names or telephone numbers.

Production needs a Google OAuth refresh token with `https://www.googleapis.com/auth/spreadsheets.readonly` scope for a Google account that can access the sheet. Configure server-only `GOOGLE_SHEETS_AUDIT_REFRESH_TOKEN` with the matching `GOOGLE_SHEETS_CLIENT_ID` and `GOOGLE_SHEETS_CLIENT_SECRET` in Railway. The existing Google Ads refresh token has only the Ads scope and cannot be reused as a Sheets authorization. A signed-in browser session and access to the spreadsheet are **not** reusable API credentials. Do not export browser cookies or put tokens in the sheet, source code, or client bundle.

The Google Sheets API must be enabled for the OAuth client's Cloud project. Granting the OAuth scope expands the app's access to spreadsheets readable by that Google account; use a dedicated account/client if sheet-scoped access is required. Obtain the OAuth grant interactively with the account owner; do not infer consent from a previously authorized Ads token.

If authorization or the API fails, the tab reports unavailable rather than displaying zero as a business result. No direct-read data is merged with Odoo Lead/Opportunity cohorts, because this sheet lacks CRM IDs and record type.
