import assert from "node:assert/strict";
import { decideSnapshotRead } from "../src/lib/snapshot-freshness.ts";

const MIN = 60_000;
const limits = { ttlMs: 5 * MIN, maxStaleMs: 30 * MIN, stuckRefreshMs: 2 * MIN };

/** Nothing running, a cache of the given age, ordinary request. */
const at = (cacheAgeMs, over = {}) =>
  decideSnapshotRead(
    { hasCache: true, cacheAgeMs, refreshRunning: false, refreshAgeMs: 0, force: false, ...over },
    limits,
  );

/* --- the stall this was written to remove ---------------------------------- */
{
  // Inside the TTL nothing happens at all: this is the common case and it must
  // stay a pure memory read.
  assert.equal(at(0), "serve-cached");
  assert.equal(at(5 * MIN - 1), "serve-cached");

  // The moment it expires the old code made this request pay for the whole
  // reload — 18k CRM rows and ~28 MB before ten more datasets. It is now served
  // from memory while the rebuild runs behind it.
  assert.equal(at(5 * MIN), "serve-cached-refresh-behind");
  assert.equal(at(29 * MIN), "serve-cached-refresh-behind");
}

/* --- one rebuild at a time ------------------------------------------------- */
{
  // A healthy rebuild is already on its way. Starting a second would read the
  // same tens of megabytes twice for no fresher answer.
  assert.equal(at(10 * MIN, { refreshRunning: true, refreshAgeMs: 30_000 }), "serve-cached");

  // Unless it has been running long enough to be presumed stuck. Nothing in the
  // read path has a timeout, so without this one hung PostgreSQL query would
  // freeze the data permanently: no later request could ever start another
  // load, and every page would serve the same snapshot forever.
  assert.equal(
    at(10 * MIN, { refreshRunning: true, refreshAgeMs: 2 * MIN + 1 }),
    "serve-cached-refresh-behind",
  );
}

/* --- the ceiling: past it, the wait beats the number ----------------------- */
{
  // Half-hour-old collections must not be reported as current just because a
  // background rebuild keeps failing.
  assert.equal(at(30 * MIN), "refresh-and-wait");
  assert.equal(at(4 * 60 * MIN), "refresh-and-wait");
  // Even then, join a rebuild in flight rather than starting a competing one.
  assert.equal(at(30 * MIN, { refreshRunning: true, refreshAgeMs: 10_000 }), "join-refresh");
}

/* --- a cold process -------------------------------------------------------- */
{
  const cold = {
    hasCache: false,
    cacheAgeMs: Infinity,
    refreshRunning: false,
    refreshAgeMs: 0,
    force: false,
  };
  assert.equal(decideSnapshotRead(cold, limits), "refresh-and-wait");
  // The warm-up at boot is already loading; a request arriving meanwhile waits
  // on that one instead of starting a second full read.
  assert.equal(
    decideSnapshotRead({ ...cold, refreshRunning: true, refreshAgeMs: 800 }, limits),
    "join-refresh",
  );
}

/* --- the Refresh button ---------------------------------------------------- */
{
  // Pressing it must never hand back the cache, however fresh.
  assert.equal(at(0, { force: true }), "refresh-and-wait");
  // Nor a rebuild already in flight: that one was requested before the button
  // was pressed, so it returns exactly the stale data the user was escaping.
  assert.equal(
    at(0, { force: true, refreshRunning: true, refreshAgeMs: 1_000 }),
    "refresh-and-wait",
  );
}

console.log("snapshot freshness tests passed.");
