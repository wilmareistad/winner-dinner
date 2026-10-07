// Milestone 5 rules: profile, notices, deleting a dinner and deleting an account.
// Every test runs in a rolled-back transaction.
import { describe, expect, it } from "vitest";
import { actAs, createAuthUser, expectSqlError, rpcAs, rpcErrorAs, withRollback } from "./helpers";
import {
  ERR,
  PERMISSION_DENIED,
  addFeature,
  addGuest,
  makeReadOnly,
  newDinner,
  roleHolders,
  statusOf,
  tokenOf,
} from "./dinner-fixtures";

async function noticesOf(db, userId) {
  const { rows } = await db.query(
    "select text from public.notices where user_id = $1 order by created_at",
    [userId]
  );
  return rows.map((r) => r.text);
}

async function visibleNotices(db, userId) {
  await actAs(db, userId);
  const { rows } = await db.query("select id, text from public.notices order by created_at");
  await db.query("reset role");
  return rows;
}

async function exists(db, table, column, id) {
  const { rows } = await db.query(`select 1 from ${table} where ${column} = $1`, [id]);
  return rows.length > 0;
}

async function profileOf(db, userId) {
  const { rows } = await db.query("select display_name, emoji from public.profiles where id = $1", [
    userId,
  ]);
  return rows[0];
}

describe("update_profile", () => {
  it("a user sets and clears their own name and emoji", () =>
    withRollback(async (db) => {
      const anna = await createAuthUser(db, "anna_1");
      await rpcAs(db, anna, "update_profile", "  Anna K  ", "🍝");
      expect(await profileOf(db, anna)).toEqual({ display_name: "Anna K", emoji: "🍝" });
      await rpcAs(db, anna, "update_profile", " ", "");
      expect(await profileOf(db, anna)).toEqual({ display_name: null, emoji: null });
    }));

  it("only changes the caller's own profile; others are untouched", () =>
    withRollback(async (db) => {
      const anna = await createAuthUser(db, "anna_1");
      const ben = await createAuthUser(db, "ben_1");
      await rpcAs(db, anna, "update_profile", "Anna", "🍝");
      expect(await profileOf(db, ben)).toEqual({ display_name: null, emoji: null });
      await actAs(db, anna);
      await expectSqlError(
        db, "update public.profiles set display_name = 'x' where id = $1", [ben], PERMISSION_DENIED
      );
      await db.query("reset role");
      await rpcErrorAs(db, null, "update_profile", ["x", null], PERMISSION_DENIED);
    }));

  it("rejects a long name and an emoji that is text", () =>
    withRollback(async (db) => {
      const anna = await createAuthUser(db, "anna_1");
      await rpcErrorAs(db, anna, "update_profile", ["x".repeat(51), null], ERR.invalid);
      for (const emoji of ["abc", "<b>", "🍝 x", "🍝".repeat(17)]) {
        await rpcErrorAs(db, anna, "update_profile", [null, emoji], ERR.invalid);
      }
      // Multi-codepoint emoji are fine.
      await rpcAs(db, anna, "update_profile", null, "👩‍🍳");
    }));

  it("other guests see the emoji, not the name; User 1 sees both", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const anna = await addGuest(db, dinnerId, "anna_1");
      const ben = await addGuest(db, dinnerId, "ben_1");
      await rpcAs(db, anna, "update_profile", "Anna K", "🍝");

      await actAs(db, ben);
      const asBen = await db.query(
        "select emoji, display_name from public.dinner_people($1) where user_id = $2",
        [dinnerId, anna]
      );
      await actAs(db, owner);
      const asOwner = await db.query(
        "select emoji, display_name from public.dinner_people($1) where user_id = $2",
        [dinnerId, anna]
      );
      await db.query("reset role");
      expect(asBen.rows).toEqual([{ emoji: "🍝", display_name: null }]);
      expect(asOwner.rows).toEqual([{ emoji: "🍝", display_name: "Anna K" }]);
    }));
});

describe("notices", () => {
  async function withNotice(db) {
    const owner = await createAuthUser(db, "owner_1");
    const dinnerId = await newDinner(db, owner);
    const dessert = await addFeature(db, owner, dinnerId);
    const anna = await addGuest(db, dinnerId, "anna_1");
    await rpcAs(db, anna, "claim_role", dessert);
    await rpcAs(db, owner, "remove_feature", dessert, true);
    return { owner, anna };
  }

  it("a user dismisses their own notice; dismissing again is fine", () =>
    withRollback(async (db) => {
      const { anna } = await withNotice(db);
      const [notice] = await visibleNotices(db, anna);
      await rpcAs(db, anna, "dismiss_notice", notice.id);
      await rpcAs(db, anna, "dismiss_notice", notice.id);
      expect(await visibleNotices(db, anna)).toEqual([]);
    }));

  it("nobody can dismiss someone else's notice", () =>
    withRollback(async (db) => {
      const { owner, anna } = await withNotice(db);
      const [notice] = await visibleNotices(db, anna);
      await rpcAs(db, owner, "dismiss_notice", notice.id);
      expect(await visibleNotices(db, anna)).toHaveLength(1);
    }));

  it("notices older than 14 days are hidden at once and removed by the cleanup job", () =>
    withRollback(async (db) => {
      const { anna } = await withNotice(db);
      await db.query(
        "insert into public.notices (user_id, text, created_at) values ($1, 'old', now() - interval '15 days')",
        [anna]
      );
      expect((await visibleNotices(db, anna)).map((n) => n.text)).not.toContain("old");

      const { rows } = await db.query(
        "select command from cron.job where jobname = 'wd-cleanup-notices' and active"
      );
      expect(rows).toHaveLength(1);
      await db.query(rows[0].command);
      expect(await noticesOf(db, anna)).toHaveLength(1);
    }));
});

describe("delete_dinner", () => {
  it("User 1 deletes the request; guests (not kicked) get a notice", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await rpcAs(db, owner, "create_dinner", "Lasagna", "2099-07-01", "19:00");
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      const ivy = await addGuest(db, dinnerId, "ivy_1", "invited");
      const ken = await addGuest(db, dinnerId, "ken_1", "kicked");
      await rpcAs(db, anna, "claim_role", dessert);

      await rpcAs(db, owner, "delete_dinner", dinnerId);
      expect(await exists(db, "public.dinners", "id", dinnerId)).toBe(false);
      expect(await exists(db, "public.features", "dinner_id", dinnerId)).toBe(false);
      expect(await exists(db, "public.participants", "dinner_id", dinnerId)).toBe(false);
      const text = '"Lasagna" (1 July 2099, 19:00) was deleted by its creator.';
      expect(await noticesOf(db, anna)).toEqual([text]);
      expect(await noticesOf(db, ivy)).toEqual([text]);
      expect(await noticesOf(db, ken)).toEqual([]);
      expect(await noticesOf(db, owner)).toEqual([]);
    }));

  it("only User 1 can delete it, and not after the dinner time", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcErrorAs(db, anna, "delete_dinner", [dinnerId], ERR.notAllowed);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "delete_dinner", [dinnerId], ERR.readOnly);
      expect(await exists(db, "public.dinners", "id", dinnerId)).toBe(true);
    }));
});

describe("delete_my_account", () => {
  it("as a guest: removed from every dinner, roles freed, others untouched", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      const ben = await addGuest(db, dinnerId, "ben_1");
      await rpcAs(db, anna, "claim_role", dessert);
      await rpcAs(db, ben, "claim_role", dessert);

      await rpcAs(db, anna, "delete_my_account");
      expect(await exists(db, "auth.users", "id", anna)).toBe(false);
      expect(await exists(db, "public.profiles", "id", anna)).toBe(false);
      expect(await statusOf(db, dinnerId, anna)).toBeNull();
      expect(await roleHolders(db, dessert)).toEqual([ben]);
      expect(await exists(db, "public.dinners", "id", dinnerId)).toBe(true);
      expect(await noticesOf(db, owner)).toEqual([]);
    }));

  it("as User 1: every dinner they created is deleted, guests get a notice that survives", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const a = await rpcAs(db, owner, "create_dinner", "Lasagna", "2099-07-01", "19:00");
      const b = await newDinner(db, owner);
      const anna = await addGuest(db, a, "anna_1");
      const ben = await addGuest(db, b, "ben_1", "declined");
      // User 1 is also a guest on someone else's dinner, which must survive.
      const other = await createAuthUser(db, "other_1");
      const elsewhere = await newDinner(db, other);
      await addGuest(db, elsewhere, "carl_1");
      await rpcAs(db, owner, "join_by_token", await tokenOf(db, elsewhere));

      await rpcAs(db, owner, "delete_my_account");
      for (const id of [a, b]) expect(await exists(db, "public.dinners", "id", id)).toBe(false);
      expect(await exists(db, "public.dinners", "id", elsewhere)).toBe(true);
      expect(await statusOf(db, elsewhere, owner)).toBeNull();
      expect(await noticesOf(db, anna)).toEqual([
        '"Lasagna" (1 July 2099, 19:00) was deleted because its creator deleted their account.',
      ]);
      expect(await noticesOf(db, ben)).toHaveLength(1);
      expect(await visibleNotices(db, anna)).toHaveLength(1);
    }));

  it("is one transaction: a failure part-way leaves no half-deleted account", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const anna = await addGuest(db, dinnerId, "anna_1");
      // Make the cascade fail after the notices were written.
      await db.query(`
        create function pg_temp.fail_delete() returns trigger language plpgsql as
        $$ begin raise exception 'simulated failure'; end; $$`);
      await db.query(
        "create trigger fail_delete before delete on public.dinners for each row execute function pg_temp.fail_delete()"
      );

      await rpcErrorAs(db, owner, "delete_my_account", [], "P0001");
      expect(await exists(db, "auth.users", "id", owner)).toBe(true);
      expect(await exists(db, "public.dinners", "id", dinnerId)).toBe(true);
      expect(await noticesOf(db, anna)).toEqual([]);
    }));

  it("cascade deletes are not blocked by the read-only check", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcAs(db, anna, "claim_role", dessert);
      await makeReadOnly(db, dinnerId);

      await rpcAs(db, anna, "delete_my_account");
      expect(await roleHolders(db, dessert)).toEqual([]);
      await rpcAs(db, owner, "delete_my_account");
      expect(await exists(db, "public.dinners", "id", dinnerId)).toBe(false);
    }));

  it("the username can be reused, and the new account inherits nothing", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcAs(db, anna, "update_profile", "Anna", "🍝");
      await rpcAs(db, anna, "claim_role", dessert);
      await rpcAs(db, owner, "remove_feature", dessert, true);
      await rpcAs(db, anna, "delete_my_account");

      const newAnna = await createAuthUser(db, "anna_1");
      expect(newAnna).not.toBe(anna);
      expect(await profileOf(db, newAnna)).toEqual({ display_name: null, emoji: null });
      expect(await statusOf(db, dinnerId, newAnna)).toBeNull();
      expect(await visibleNotices(db, newAnna)).toEqual([]);
      await actAs(db, newAnna);
      expect((await db.query("select id from public.dinners")).rows).toEqual([]);
      await db.query("reset role");
    }));

  it("takes no user id, so it can only ever delete the caller; anonymous cannot call it", () =>
    withRollback(async (db) => {
      const { rows } = await db.query(
        "select pronargs from pg_proc where oid = 'public.delete_my_account'::regproc"
      );
      expect(rows).toEqual([{ pronargs: 0 }]);
      await rpcErrorAs(db, null, "delete_my_account", [], PERMISSION_DENIED);
      const anna = await createAuthUser(db, "anna_1");
      await rpcErrorAs(db, anna, "notify_dinner_deleted", [null, "x"], PERMISSION_DENIED);
    }));
});
