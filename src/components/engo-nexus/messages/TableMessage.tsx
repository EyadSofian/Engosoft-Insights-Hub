import type { TableMessage as TableMessageType } from "../lib/nexus-message-schema";
import { formatMetric } from "../lib/nexus-format";
import { SourceBadges } from "./SourceBadges";

/**
 * A small table. Scrolls inside its own container so a wide result never makes
 * the chat panel — or the dashboard behind it — scroll sideways.
 *
 * `truncated` is surfaced explicitly: a capped table read as a complete one is
 * how a partial population gets aggregated as if it were the whole.
 */
export function TableMessage({ message, lang }: { message: TableMessageType; lang: "ar" | "en" }) {
  return (
    <div className="rounded-xl border border-border bg-bg-subtle p-3" data-testid="nexus-table">
      {message.title && <h4 className="mb-2 text-xs font-semibold text-text">{message.title}</h4>}
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-max text-[11px]">
          <thead>
            <tr className="border-b border-border">
              {message.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className="whitespace-nowrap px-2 py-1.5 text-start font-semibold text-text-muted"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {message.rows.map((row, index) => (
              <tr key={index} className="border-b border-border/60 last:border-0">
                {message.columns.map((column) => (
                  <td key={column.key} className="whitespace-nowrap px-2 py-1.5 text-text">
                    <span className={column.unit === "text" ? "" : "num"}>
                      {formatMetric(row[column.key], column.unit ?? "count", column.currency)}
                    </span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {message.truncated && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-400">
          {lang === "ar"
            ? "النتائج مقصوصة — دي مش كل الصفوف."
            : "Results are truncated — these are not all the rows."}
        </p>
      )}
      <SourceBadges sources={message.sources} lang={lang} />
    </div>
  );
}
