// Proves the race harness really runs transactions in parallel on separate
// connections. Later milestones use race() for the slot and guest-limit tests.
import { describe, expect, it } from "vitest";
import { race } from "./helpers";

describe("race harness", () => {
  it("two transactions competing for one lock: exactly one wins", async () => {
    const lockKey = Math.floor(Math.random() * 1e9);
    const tryLock = async (client) => {
      const { rows } = await client.query(
        "select pg_try_advisory_xact_lock($1) as won, pg_backend_pid() as pid",
        [lockKey]
      );
      // Hold the lock long enough for the other connection to try.
      await client.query("select pg_sleep(0.3)");
      return rows[0];
    };

    const results = await race([tryLock, tryLock]);
    const values = results.map((r) => r.value);

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(new Set(values.map((v) => v.pid)).size).toBe(2);
    expect(values.filter((v) => v.won)).toHaveLength(1);
  });
});
