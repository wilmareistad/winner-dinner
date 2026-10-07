// Milestone 4 rules: cost split. Every test runs in a rolled-back transaction.
import { describe, expect, it } from "vitest";
import { actAs, createAuthUser, expectSqlError, rpcAs, rpcErrorAs, withRollback } from "./helpers";
import { ERR, PERMISSION_DENIED, addGuest, makeReadOnly, newDinner } from "./dinner-fixtures";

// What the caller gets from every way of reading cost: the table and the function.
async function costAs(db, userId, dinnerId) {
  await actAs(db, userId);
  const table = await db.query("select total_sek from public.dinner_costs where dinner_id = $1", [
    dinnerId,
  ]);
  const fn = await db.query("select * from public.dinner_cost($1)", [dinnerId]);
  await db.query("reset role");
  return { table: table.rows, fn: fn.rows };
}

async function perPerson(db, userId, dinnerId) {
  const { fn } = await costAs(db, userId, dinnerId);
  return fn[0] ?? null;
}

describe("per-person amount", () => {
  it("E1/E2: 600 SEK for User 1 + 3 guests is 150 each; one declines and it is 200", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const a = await addGuest(db, dinnerId, "anna_1");
      await addGuest(db, dinnerId, "ben_1");
      await addGuest(db, dinnerId, "carl_1");
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 600);

      expect(await perPerson(db, a, dinnerId)).toEqual({
        total_sek: 600,
        attendees: 4,
        per_person_sek: 150,
      });
      await rpcAs(db, a, "set_answer", dinnerId, "declined");
      expect((await perPerson(db, owner, dinnerId)).per_person_sek).toBe(200);
    }));

  it("rounds up to a whole krona (600 / 7 = 86)", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      for (let i = 0; i < 6; i++) await addGuest(db, dinnerId, `g_${i}`);
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 600);
      expect(await perPerson(db, owner, dinnerId)).toMatchObject({ attendees: 7, per_person_sek: 86 });
    }));

  it("zero accepted guests: User 1 alone pays the total, no divide-by-zero", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await addGuest(db, dinnerId, "ivy_1", "invited");
      await addGuest(db, dinnerId, "dan_1", "declined");
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 450);
      expect(await perPerson(db, owner, dinnerId)).toEqual({
        total_sek: 450,
        attendees: 1,
        per_person_sek: 450,
      });
    }));

  it("the total can be changed and the amount follows", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await addGuest(db, dinnerId, "anna_1");
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 600);
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 1000);
      expect((await perPerson(db, owner, dinnerId)).per_person_sek).toBe(500);
    }));
});

describe("cost split off: no amount anywhere", () => {
  it("before it is ever turned on, nobody gets a row", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "anna_1");
      for (const id of [owner, guest]) {
        expect(await costAs(db, id, dinnerId)).toEqual({ table: [], fn: [] });
      }
    }));

  it("turning it off removes the stored total, and User 1, guests and anonymous get nothing", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "anna_1");
      const invited = await addGuest(db, dinnerId, "ivy_1", "invited");
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 600);
      await rpcAs(db, owner, "set_cost_split", dinnerId, false);

      const { rows } = await db.query("select * from public.dinner_costs where dinner_id = $1", [
        dinnerId,
      ]);
      expect(rows).toEqual([]);
      for (const id of [owner, guest, invited]) {
        expect(await costAs(db, id, dinnerId)).toEqual({ table: [], fn: [] });
      }
      await actAs(db, null);
      await expectSqlError(db, "select * from public.dinner_costs", [], PERMISSION_DENIED);
      await expectSqlError(db, "select * from public.dinner_cost($1)", [dinnerId], PERMISSION_DENIED);
      await db.query("reset role");
    }));

  it("even a stray total row is hidden while the flag is off (RLS checks the flag)", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await db.query("insert into public.dinner_costs (dinner_id, total_sek) values ($1, 600)", [
        dinnerId,
      ]);
      expect(await costAs(db, owner, dinnerId)).toEqual({ table: [], fn: [] });
    }));
});

describe("who sees the cost while it is on", () => {
  it("User 1 and guests in any status except kicked; strangers get nothing", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guests = [
        await addGuest(db, dinnerId, "anna_1"),
        await addGuest(db, dinnerId, "ivy_1", "invited"),
        await addGuest(db, dinnerId, "dan_1", "declined"),
      ];
      const kicked = await addGuest(db, dinnerId, "ken_1", "kicked");
      const stranger = await createAuthUser(db, "stranger");
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 600);

      for (const id of [owner, ...guests]) {
        const { table, fn } = await costAs(db, id, dinnerId);
        expect(table).toEqual([{ total_sek: 600 }]);
        expect(fn).toHaveLength(1);
      }
      for (const id of [kicked, stranger]) {
        expect(await costAs(db, id, dinnerId)).toEqual({ table: [], fn: [] });
      }
    }));
});

describe("set_cost_split", () => {
  it("only User 1 can change it; clients cannot write the table", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "anna_1");
      await rpcErrorAs(db, guest, "set_cost_split", [dinnerId, true, 600], ERR.notAllowed);
      await actAs(db, owner);
      await expectSqlError(
        db,
        "insert into public.dinner_costs (dinner_id, total_sek) values ($1, 600)",
        [dinnerId],
        PERMISSION_DENIED
      );
      await expectSqlError(
        db, "update public.dinners set cost_split = true where id = $1", [dinnerId], PERMISSION_DENIED
      );
      await db.query("reset role");
    }));

  it("the total must be a whole number from 1 to 1,000,000 SEK", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      for (const total of [null, 0, -5, 1000001]) {
        await rpcErrorAs(db, owner, "set_cost_split", [dinnerId, true, total], ERR.invalid);
      }
      await rpcErrorAs(db, owner, "set_cost_split", [dinnerId, null, 600], ERR.invalid);
    }));

  it("cannot be changed after the dinner time, but the amount stays readable", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcAs(db, owner, "set_cost_split", dinnerId, true, 600);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "set_cost_split", [dinnerId, true, 900], ERR.readOnly);
      await rpcErrorAs(db, owner, "set_cost_split", [dinnerId, false], ERR.readOnly);
      expect((await perPerson(db, owner, dinnerId)).total_sek).toBe(600);
    }));
});
