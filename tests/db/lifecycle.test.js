// Milestone 6 rules: read-only after the dinner time, and the cleanup 2 weeks
// later. Every test runs in a rolled-back transaction. The race with a viewer
// is in dinners-race.test.js.
import { describe, expect, it } from "vitest";
import { actAs, createAuthUser, rpcAs, rpcErrorAs, withRollback } from "./helpers";
import {
  ERR,
  PERMISSION_DENIED,
  addFeature,
  addGuest,
  makeReadOnly,
  newDinner,
  tokenOf,
} from "./dinner-fixtures";

async function setStartsAt(db, dinnerId, interval) {
  await db.query(`update public.dinners set starts_at = now() - $2::interval where id = $1`, [
    dinnerId,
    interval,
  ]);
}

async function count(db, table, dinnerId) {
  const column = table === "dinners" ? "id" : "dinner_id";
  const { rows } = await db.query(
    `select count(*)::int as n from public.${table} where ${column} = $1`,
    [dinnerId]
  );
  return rows[0].n;
}

describe("read-only after the dinner time", () => {
  it("every write function is rejected, and the request stays readable", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await addGuest(db, dinnerId, "ben_1", "kicked");
      await rpcAs(db, anna, "claim_role", dessert);
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 600);
      await makeReadOnly(db, dinnerId);

      const attempts = [
        [anna, "set_answer", [dinnerId, "declined"]],
        [anna, "claim_role", [dessert]],
        [anna, "unclaim_role", [dessert]],
        [owner, "add_feature", [dinnerId, "snack", 2]],
        [owner, "update_dinner", [dinnerId, "Soup", "2099-01-01", "19:00"]],
        [owner, "set_link_enabled", [dinnerId, false]],
        [owner, "set_slots", [dessert, 5]],
        [owner, "remove_feature", [dessert, true]],
        [owner, "kick_guest", [dinnerId, anna]],
        [owner, "readd_guest", [dinnerId, "ben_1"]],
        [owner, "set_cost_split", [dinnerId, false]],
        [owner, "delete_dinner", [dinnerId]],
      ];
      for (const [user, fn, args] of attempts) {
        await rpcErrorAs(db, user, fn, args, ERR.readOnly);
      }
      const newcomer = await createAuthUser(db, "new_1");
      await rpcErrorAs(db, newcomer, "join_by_token", [await tokenOf(db, dinnerId)], ERR.linkNotValid);

      for (const user of [owner, anna]) {
        await actAs(db, user);
        const dinners = await db.query("select id from public.dinners where id = $1", [dinnerId]);
        const people = await db.query("select * from public.dinner_people($1)", [dinnerId]);
        const roles = await db.query("select * from public.roles where dinner_id = $1", [dinnerId]);
        const cost = await db.query("select * from public.dinner_cost($1)", [dinnerId]);
        await db.query("reset role");
        expect(dinners.rows).toHaveLength(1);
        expect(people.rows.length).toBeGreaterThanOrEqual(2);
        expect(roles.rows).toHaveLength(2);
        expect(cost.rows[0].per_person_sek).toBe(300);
      }
    }));
});

describe("cleanup_old_dinners", () => {
  it("deletes only dinners more than 2 weeks past, with everything that belongs to them", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const old = await newDinner(db, owner);
      const recent = await newDinner(db, owner);
      const future = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, old);
      const anna = await addGuest(db, old, "anna_1");
      await rpcAs(db, anna, "claim_role", dessert);
      await rpcAs(db, owner, "set_cost_split", old, true, 600);
      await setStartsAt(db, old, "14 days 1 minute");
      await setStartsAt(db, recent, "13 days 23 hours");

      const { rows } = await db.query("select public.cleanup_old_dinners() as n");
      expect(rows[0].n).toBeGreaterThanOrEqual(1);
      for (const table of ["dinners", "features", "roles", "participants", "dinner_costs"]) {
        expect(await count(db, table, old)).toBe(0);
      }
      expect(await count(db, "dinners", recent)).toBe(1);
      expect(await count(db, "dinners", future)).toBe(1);
      // No warning or notice is sent.
      const notices = await db.query("select * from public.notices where user_id = $1", [anna]);
      expect(notices.rows).toEqual([]);
    }));

  it("after cleanup the request is not found and the link is not valid", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const anna = await addGuest(db, dinnerId, "anna_1");
      const token = await tokenOf(db, dinnerId);
      await setStartsAt(db, dinnerId, "15 days");
      await db.query("select public.cleanup_old_dinners()");

      await rpcErrorAs(db, anna, "set_answer", [dinnerId, "declined"], ERR.notFound);
      await rpcErrorAs(db, anna, "join_by_token", [token], ERR.linkNotValid);
      await actAs(db, owner);
      expect((await db.query("select id from public.dinners")).rows).toEqual([]);
      await db.query("reset role");
    }));

  it("runs as an hourly pg_cron job, and clients cannot call it", () =>
    withRollback(async (db) => {
      const { rows } = await db.query(
        "select schedule, command, active from cron.job where jobname = 'wd-cleanup-dinners'"
      );
      expect(rows).toEqual([
        { schedule: "43 * * * *", command: "select public.cleanup_old_dinners()", active: true },
      ]);
      const owner = await createAuthUser(db, "owner_1");
      await rpcErrorAs(db, owner, "cleanup_old_dinners", [], PERMISSION_DENIED);
    }));
});
