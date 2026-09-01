import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const commitSchema = z.object({
  name: z.string().trim().min(1).max(160),
  effectiveFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal("")),
  effectiveTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .or(z.literal("")),
  taxInclusive: z.boolean().default(true),
  baseCurrency: z.string().trim().max(8).default("SAR"),
  notes: z.string().trim().max(2000).default(""),
});

const schema = z
  .object({
    source: z.enum(["xlsx", "google_sheet"]),
    /** Base64 of the .xlsx, for the upload path. */
    contentBase64: z.string().max(14_000_000).optional(),
    fileName: z.string().max(260).default("price-list.xlsx"),
    sheetUrl: z.string().url().max(500).optional(),
    tabs: z.array(z.string().max(120)).max(20).optional(),
    offerDateReading: z.enum(["day_first", "month_first", "unresolved"]).default("unresolved"),
    baseCurrency: z.string().trim().max(8).default("SAR"),
    localCurrency: z.string().trim().max(8).default("EGP"),
    /** Present only when the reviewer has looked at the preview and accepted it. */
    commit: commitSchema.optional(),
  })
  .refine(
    (input) =>
      input.source === "xlsx" ? !!input.contentBase64 : !!input.sheetUrl && !!input.tabs?.length,
    { message: "a workbook or a sheet URL with tab names is required" },
  );

/**
 * Read a workbook or a Google Sheet and show what it would import.
 *
 * Preview and commit are the same call with a flag rather than two, because the
 * parse result is nearly a thousand rows: round-tripping it through the browser
 * so it could be posted back is a megabyte of traffic and an opportunity for the
 * numbers to be edited on the way. What the reviewer approves is what the server
 * already parsed.
 *
 * A commit always produces a *draft*. Publishing is a separate, audited action.
 */
export const Route = createFileRoute("/api/pricing/import/preview")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { guard, body, json, fail, UPLOAD_BODY_LIMIT } =
          await import("@/lib/pricing/pricing-api.server");
        const authorized = guard(request);
        if (!authorized.ok) return authorized.response;

        const parsed = await body(request, schema, UPLOAD_BODY_LIMIT);
        if (!parsed.ok) return parsed.response;
        const input = parsed.data;

        try {
          const { previewWorkbook, previewGoogleSheet, commitPreview } =
            await import("@/lib/pricing/price-import.server");
          const options = {
            offerDateReading: input.offerDateReading,
            baseCurrency: input.baseCurrency,
            localCurrency: input.localCurrency,
          };

          const preview =
            input.source === "xlsx"
              ? previewWorkbook(
                  Buffer.from(input.contentBase64 ?? "", "base64"),
                  input.fileName,
                  options,
                )
              : await previewGoogleSheet(input.sheetUrl ?? "", input.tabs ?? [], options);

          if (!preview.ok) return fail(preview.error || "The source could not be read.");

          // The parsed rows are heavy and the screen only needs a sample plus the
          // counts. Publishing reads from the draft, not from this response.
          const sample = preview.parse.items.slice(0, 120);
          const response = {
            ok: true,
            sourceType: preview.sourceType,
            sourceName: preview.sourceName,
            sourceUrl: preview.sourceUrl,
            sourceChecksum: preview.sourceChecksum,
            sheets: preview.sheets,
            summary: preview.summary,
            counts: preview.parse.counts,
            duplicateCodes: preview.parse.duplicateCodes.slice(0, 50),
            issues: preview.parse.issues.slice(0, 200),
            unresolvedDates: preview.unresolvedDates,
            sample,
            sampleTruncated: preview.parse.items.length > sample.length,
            book: null as unknown,
            committed: false,
          };

          if (!input.commit) return json(response);

          const book = await commitPreview(preview, input.commit, authorized.label);
          const { invalidateComplianceCache } = await import("@/lib/pricing/compliance.server");
          invalidateComplianceCache();
          return json({
            ...response,
            book,
            committed: true,
            by: authorized.actor.name || authorized.actor.id,
          });
        } catch (error) {
          return fail(error instanceof Error ? error.message : "The import failed.");
        }
      },
    },
  },
});
