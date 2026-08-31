import assert from "node:assert/strict";
import {
  FRESH_WINDOW_DAYS,
  claimsAnsweredReply,
  callCanCoverLead,
  closeRateOf,
  isHotPriority,
  leadAgeDays,
  leadCallAggregateKey,
  leadStageBucket,
  sortUncalledLeads,
  summarizeUncalledMonths,
  uncalledLeadSeverity,
} from "../src/lib/uncalled-leads.ts";

/**
 * The employee tab prints "لم يتصل بها أحد: 995" with nothing behind it. The
 * pop-up that names those 995 is only useful if the ranking is trustworthy, so
 * the ranking is pinned here against the stage and priority vocabulary of the
 * live Odoo export (18,380 CRM rows read 2026-07-22).
 */

const facts = (over = {}) => ({
  stage: "Contact",
  priority: "Cold",
  callingReply: "",
  ageDays: 30,
  calledByAny: false,
  ...over,
});

/* --- the stage vocabulary Odoo actually writes ---------------------------- */
{
  // Every label observed in the live export, with its true frequency.
  const observed = [
    ["Contact", "fresh"],
    ["Lost Verification", "junk"],
    ["Interested / مهتم ( sales )", "deal"],
    ["Postponed", "stalled"],
    ["Won / ربح", "won"],
    ["Fresh", "fresh"],
    ["Awareness", "fresh"],
    ["Not Reached", "stalled"],
    ["No Communication", "stalled"],
    ["Quotation / عرض سعر", "deal"],
    ["old data", "junk"],
    ["Old Auto Dialer", "junk"],
    ["Wrong Number", "junk"],
    ["Re-assign", "fresh"],
    ["Technical Proposal ( presales )", "deal"],
    ["Retention / إعادة شراء", "deal"],
    ["Lost / خسارة", "lost"],
  ];
  for (const [stage, bucket] of observed) {
    assert.equal(leadStageBucket(stage), bucket, `${stage} belongs in ${bucket}`);
  }

  // The bilingual half must resolve on its own: the archive drops the English
  // side on some rows, exactly as it does for Won.
  assert.equal(leadStageBucket("عرض سعر"), "deal", "the Arabic half of Quotation still reads");
  assert.equal(leadStageBucket("ربح"), "won", "and so does the Arabic half of Won");

  // Substring matching is the trap: `Lost Verification` contains no live deal.
  assert.equal(leadStageBucket("Lost Verification"), "junk", "Verification is not a proposal");
  assert.equal(leadStageBucket(""), "other", "a blank stage is unknown, not junk");
  assert.equal(leadStageBucket("Something New"), "other", "an unseen stage stays actionable");
}

/* --- a call before lead creation cannot count as follow-up ---------------- */
{
  const before = {
    phone: "966500000000",
    agentName: "Agent",
    agentExtension: "101",
    callDate: "2026-08-05",
    firstCallAt: "2026-08-05T09:00:00Z",
    latestCallAt: "2026-08-05T09:05:00Z",
  };
  const after = { ...before, callDate: "2026-08-11" };
  assert.ok(
    !callCanCoverLead(before, "2026-08-10"),
    "an older customer call does not cover a new opportunity",
  );
  assert.ok(callCanCoverLead(after, "2026-08-10"), "a call after creation does cover it");
  assert.notEqual(
    leadCallAggregateKey(before),
    leadCallAggregateKey(after),
    "daily aggregates never collapse a month of calls into one row",
  );
}

/* --- priority and the hand-filled calling reply --------------------------- */
{
  assert.ok(isHotPriority("Very Hot"), "Very Hot is hot");
  assert.ok(isHotPriority("hot"), "casing must not cost an escalation");
  assert.ok(!isHotPriority("Intermediate"), "Intermediate is not hot");
  assert.ok(!isHotPriority("Cold"), "and neither is Cold");
  assert.ok(claimsAnsweredReply("Answered"), "the salesperson recorded an answered call");
  assert.ok(!claimsAnsweredReply("Not answer"), "an unanswered attempt is not a claim");
  assert.ok(!claimsAnsweredReply("Max Trials"), "and neither is a trial cap");
}

/* --- a junk stage never escalates, whatever else is on the record --------- */
{
  // 28 Wrong Number rows carry stale priorities. Letting them inherit
  // `hot_priority` would bury the real queue under records nobody should call.
  const result = uncalledLeadSeverity(
    facts({ stage: "Wrong Number", priority: "Very Hot", ageDays: 1 }),
  );
  assert.equal(result.status, "stable", "a wrong number is the system working");
  assert.deepEqual(result.reasons, ["junk_stage"], "and it reports exactly why");
}

/* --- what makes an un-contacted lead critical ----------------------------- */
{
  assert.equal(
    uncalledLeadSeverity(facts({ priority: "Very Hot", ageDays: 200 })).status,
    "critical",
    "a hot lead nobody called stays critical however old it is",
  );
  assert.equal(
    uncalledLeadSeverity(facts({ stage: "Quotation / عرض سعر", ageDays: 200 })).status,
    "critical",
    "a live quotation with no call behind it is critical",
  );
  assert.equal(
    uncalledLeadSeverity(facts({ stage: "Fresh", ageDays: FRESH_WINDOW_DAYS })).status,
    "warning",
    "a fresh lead from a prior day needs follow-up but is not an automatic emergency",
  );
  assert.equal(
    uncalledLeadSeverity(facts({ stage: "Fresh", ageDays: FRESH_WINDOW_DAYS + 1 })).status,
    "critical",
    "one day past the response window, the same lead escalates",
  );
  assert.equal(
    uncalledLeadSeverity(facts({ stage: "Quotation / عرض سعر", priority: "Very Hot", ageDays: 0 }))
      .status,
    "fresh",
    "a lead created today stays inside the response grace period even when hot",
  );

  /**
   * The reconciliation flag. `Calling reply? = Answered` is typed by hand in
   * Odoo; 5,278 rows carry it. When the PBX has no call for that phone the two
   * systems disagree, and that row is worth reading before any coaching
   * conversation happens.
   */
  const claimed = uncalledLeadSeverity(facts({ callingReply: "Answered", ageDays: 200 }));
  assert.equal(claimed.status, "critical", "a recorded reply with no PBX call is critical");
  assert.ok(claimed.reasons.includes("reply_without_call"), "and it is named as such");

  // Once a colleague did reach the lead, the reply is plausibly theirs.
  assert.ok(
    !uncalledLeadSeverity(
      facts({ callingReply: "Answered", calledByAny: true, ageDays: 200 }),
    ).reasons.includes("reply_without_call"),
    "a colleague's call explains the recorded reply",
  );
}

/* --- warnings and overdue actionable leads -------------------------------- */
{
  assert.equal(
    uncalledLeadSeverity(facts({ stage: "Postponed", ageDays: 400 })).status,
    "warning",
    "a parked lead is a warning, not an emergency",
  );
  assert.equal(
    uncalledLeadSeverity(facts({ ageDays: FRESH_WINDOW_DAYS })).status,
    "warning",
    "an ordinary lead inside the response window needs follow-up",
  );
  assert.equal(
    uncalledLeadSeverity(facts({ ageDays: FRESH_WINDOW_DAYS + 1 })).status,
    "critical",
    "past the response window, an untouched actionable lead is critical",
  );
  for (const stage of ["Contact", "Awareness"]) {
    const overdue = uncalledLeadSeverity(facts({ stage, ageDays: 26 }));
    assert.equal(overdue.status, "critical", `${stage} never becomes harmless with age`);
    assert.ok(
      overdue.reasons.includes("aging_untouched"),
      `${stage} explains that its response window is overdue`,
    );
  }

  // Closed rows belong in outcome reporting, never in the current follow-up queue.
  const won = uncalledLeadSeverity(facts({ stage: "Won / ربح", ageDays: 300 }));
  assert.equal(won.status, "stable", "a win is excluded from active follow-up");
  const lost = uncalledLeadSeverity(facts({ stage: "Lost / خسارة", ageDays: 300 }));
  assert.equal(lost.status, "stable", "a lost lead is excluded from active follow-up");
}

/* --- an unanswered Chatwoot message is actionable, not proof of follow-up - */
{
  const waiting = uncalledLeadSeverity(facts({ ageDays: 1, chatAwaitingReply: true }));
  assert.equal(waiting.status, "critical");
  assert.ok(waiting.reasons.includes("chat_awaiting_reply"));
}

/* --- several reasons can fire on one lead --------------------------------- */
{
  const both = uncalledLeadSeverity(
    facts({ stage: "Quotation / عرض سعر", priority: "Very Hot", ageDays: 5 }),
  );
  assert.deepEqual(
    both.reasons,
    ["hot_priority", "active_deal"],
    "a hot live quotation reports both reasons, not just the first",
  );
}

/* --- age is measured to the end of the window, never to today ------------- */
{
  assert.equal(leadAgeDays("2026-07-30", "2026-07-31"), 1, "one day old when July closed");
  assert.equal(leadAgeDays("2026-07-30T09:15:00", "2026-07-31"), 1, "a timestamp is trimmed");
  assert.equal(leadAgeDays("2026-08-05", "2026-08-01"), 0, "a lead is never negatively old");
  assert.equal(leadAgeDays("", "2026-08-01"), null, "a missing creation date has no age");
}

/* --- "اللي تاريخها قريب تبقى هي في الأول وحالاتها حرجة" ------------------- */
{
  const rows = [
    { id: "1", createdAt: "2026-08-01", status: "warning" },
    { id: "2", createdAt: "2026-06-01", status: "critical" },
    { id: "3", createdAt: "2026-08-20", status: "critical" },
    { id: "5", createdAt: "2026-08-26", status: "fresh" },
    { id: "4", createdAt: "2026-08-25", status: "stable" },
  ];

  assert.deepEqual(
    sortUncalledLeads(rows, "urgent").map((row) => row.id),
    ["3", "2", "1", "5", "4"],
    "critical first, and the newest critical lead leads the queue",
  );
  assert.deepEqual(
    sortUncalledLeads(rows, "newest").map((row) => row.id),
    ["5", "4", "3", "1", "2"],
    "the plain chronological view ignores severity",
  );
  assert.deepEqual(
    sortUncalledLeads(rows, "oldest").map((row) => row.id),
    ["2", "1", "3", "4", "5"],
    "and reverses cleanly",
  );

  // Same day, same severity: the order must not depend on Map insertion.
  const tied = [
    { id: "b", createdAt: "2026-08-20", status: "critical" },
    { id: "a", createdAt: "2026-08-20", status: "critical" },
  ];
  assert.deepEqual(
    sortUncalledLeads(tied, "urgent").map((row) => row.id),
    ["a", "b"],
    "ties break on id so the list is stable between reloads",
  );
  assert.equal(rows[0].id, "1", "sorting never mutates the caller's array");
}

/* --- the monthly ratios behind "بالنسبة للشهر" ---------------------------- */
{
  const months = summarizeUncalledMonths([
    {
      month: "2026-07",
      calledByAny: true,
      calledByOwner: true,
      calls: 3,
      ownerCalls: 2,
      outcome: "won",
    },
    {
      month: "2026-07",
      calledByAny: true,
      calledByOwner: false,
      calls: 2,
      ownerCalls: 0,
      outcome: "lost",
    },
    {
      month: "2026-07",
      calledByAny: false,
      calledByOwner: false,
      calls: 0,
      ownerCalls: 0,
      outcome: "open",
    },
    {
      month: "2026-08",
      calledByAny: false,
      calledByOwner: false,
      calls: 0,
      ownerCalls: 0,
      outcome: "open",
    },
    {
      month: "",
      calledByAny: false,
      calledByOwner: false,
      calls: 0,
      ownerCalls: 0,
      outcome: "open",
    },
  ]);

  assert.equal(months.length, 2, "a lead with no creation month has no month to sit in");
  const [july, august] = months;
  assert.equal(july.month, "2026-07", "months come back in calendar order");
  assert.equal(july.leads, 3);
  assert.equal(july.called, 2);
  assert.equal(july.uncalled, 1);
  assert.equal(july.ownerUncalled, 2, "the owner counter includes the colleague's rescue");
  assert.equal(july.calls, 5);
  assert.equal(july.callsPerLead, 5 / 3, "effort per assigned lead");
  assert.equal(july.ownerCalls, 2, "the employee's own calls stay separate from colleague calls");
  assert.equal(july.ownerCallsPerLead, 2 / 3, "owner effort per assigned lead");
  assert.equal(july.closeRate, 50, "won ÷ decided — the open lead is not a loss");
  assert.equal(july.conversionRate, (1 / 3) * 100, "won ÷ every assigned lead");
  assert.equal(july.contactRate, (2 / 3) * 100);

  /**
   * August decided nothing. A 0% close rate there would read as "closed
   * nothing" when the truth is "nothing has closed yet" — the same distinction
   * the rest of the dashboard keeps by rendering `null` rather than a zero.
   */
  assert.equal(august.closeRate, null, "an undecided month has no close rate");
  assert.equal(august.callsPerLead, 0, "but it does have a real, measured zero effort");
  assert.equal(august.conversionRate, 0, "and a real zero conversion");
}

/* --- a missing Lost feed must not become a 100% close rate ---------------- */
{
  /**
   * Every loss lives in the archived population. When that feed is down the
   * decided denominator collapses to the wins alone and the arithmetic returns
   * a confident 100% — observed directly on a local run whose Lost tab failed
   * to load: 51 won, 0 lost, "نسبة الإغلاق 100.0%" printed on the employee
   * screen. That is worse than a blank, because it is wrong in the flattering
   * direction on the screen where people are judged.
   */
  assert.equal(closeRateOf(51, 0, false), null, "no Lost feed, no close rate");
  assert.equal(closeRateOf(51, 0, true), 100, "a real 100% is still reported");
  assert.equal(closeRateOf(1, 1, true), 50, "and an ordinary rate is untouched");
  assert.equal(closeRateOf(0, 0, true), null, "nothing decided is still nothing decided");

  const facts = [
    {
      month: "2026-08",
      calledByAny: false,
      calledByOwner: false,
      calls: 0,
      ownerCalls: 0,
      outcome: "won",
    },
    {
      month: "2026-08",
      calledByAny: false,
      calledByOwner: false,
      calls: 0,
      ownerCalls: 0,
      outcome: "open",
    },
  ];
  assert.equal(
    summarizeUncalledMonths(facts, { lostAvailable: false })[0].closeRate,
    null,
    "the month rollup withholds it too",
  );
  assert.equal(
    summarizeUncalledMonths(facts)[0].closeRate,
    100,
    "and defaults to reporting it when Lost is present",
  );
  // The conversion rate has an authoritative denominator either way: it counts
  // every assigned lead, not just the decided ones.
  assert.equal(
    summarizeUncalledMonths(facts, { lostAvailable: false })[0].conversionRate,
    50,
    "won ÷ all leads survives a missing Lost feed",
  );
}

console.log("uncalled-leads: all assertions passed");
