// Milestone 1 rules, enforced by the database. Every test runs in a rolled-back
// transaction. Concurrency is covered in dinners-race.test.js.
import { describe, expect, it } from "vitest";
import {
  actAs,
  createAuthUser,
  expectSqlError,
  rpcAs,
  rpcErrorAs,
  withRollback,
} from "./helpers";
import {
  ERR,
  PERMISSION_DENIED,
  addFeature,
  addGuest,
  inDays,
  makeReadOnly,
  newDinner,
  roleCount,
  roleHolders,
  tokenOf,
} from "./dinner-fixtures";

async function hostFeature(db, dinnerId) {
  const { rows } = await db.query(
    "select id, slots from public.features where dinner_id = $1 and type = 'host'",
    [dinnerId]
  );
  return rows[0];
}

async function statusOf(db, dinnerId, userId) {
  const { rows } = await db.query(
    "select status from public.participants where dinner_id = $1 and user_id = $2",
    [dinnerId, userId]
  );
  return rows.map((r) => r.status);
}

describe("create_dinner", () => {
  it("creates the dinner with User 1 accepted and holding Host (1 slot)", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);

      expect(await statusOf(db, dinnerId, owner)).toEqual(["accepted"]);
      const host = await hostFeature(db, dinnerId);
      expect(host.slots).toBe(1);
      expect(await roleHolders(db, host.id)).toEqual([owner]);
      expect((await tokenOf(db, dinnerId)).length).toBeGreaterThanOrEqual(24);
    }));

  it("stores the date and time as Swedish time", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await rpcAs(db, owner, "create_dinner", "Soup", "2099-07-01", "19:00");
      const { rows } = await db.query(
        "select starts_at = '2099-07-01 17:00:00+00'::timestamptz as ok from public.dinners where id = $1",
        [dinnerId]
      );
      expect(rows[0].ok).toBe(true);
    }));

  it("rejects a date in the past", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const error = await rpcErrorAs(
        db,
        owner,
        "create_dinner",
        ["Soup", inDays(-2), "19:00"],
        ERR.invalid
      );
      expect(error.message).toBe("The dinner cannot be in the past.");
    }));

  it("rejects an empty title and a recipe link that is not http(s)", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      await rpcErrorAs(db, owner, "create_dinner", ["  ", inDays(7), "19:00"], ERR.invalid);
      await rpcErrorAs(
        db,
        owner,
        "create_dinner",
        ["Soup", inDays(7), "19:00", null, "javascript:alert(1)"],
        ERR.invalid
      );
    }));

  it("an anonymous visitor cannot create a dinner", () =>
    withRollback(async (db) => {
      await rpcErrorAs(db, null, "create_dinner", ["Soup", inDays(7), "19:00"], PERMISSION_DENIED);
    }));
});

describe("join_by_token", () => {
  it("a new user joins as invited, and opening the link again adds no row", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await createAuthUser(db, "guest_1");
      const token = await tokenOf(db, dinnerId);

      expect(await rpcAs(db, guest, "join_by_token", token)).toBe(dinnerId);
      expect(await rpcAs(db, guest, "join_by_token", token)).toBe(dinnerId);
      expect(await statusOf(db, dinnerId, guest)).toEqual(["invited"]);
    }));

  it("User 1 opening their own link adds no row", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      expect(await rpcAs(db, owner, "join_by_token", await tokenOf(db, dinnerId))).toBe(dinnerId);
      expect(await statusOf(db, dinnerId, owner)).toEqual(["accepted"]);
    }));

  it("an unknown token gives 'link not valid'", () =>
    withRollback(async (db) => {
      const guest = await createAuthUser(db, "guest_1");
      const error = await rpcErrorAs(db, guest, "join_by_token", ["nope"], ERR.linkNotValid);
      expect(error.message).toBe("This link is not valid.");
      await rpcErrorAs(db, guest, "join_by_token", [null], ERR.linkNotValid);
    }));

  it("a disabled link gives 'link not valid' to new users, existing guests keep access", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const existing = await addGuest(db, dinnerId, "guest_1", "declined");
      const token = await tokenOf(db, dinnerId);
      await db.query("update public.dinners set link_enabled = false where id = $1", [dinnerId]);

      const newcomer = await createAuthUser(db, "guest_2");
      await rpcErrorAs(db, newcomer, "join_by_token", [token], ERR.linkNotValid);
      expect(await statusOf(db, dinnerId, newcomer)).toEqual([]);
      expect(await rpcAs(db, existing, "join_by_token", token)).toBe(dinnerId);
      expect(await statusOf(db, dinnerId, existing)).toEqual(["declined"]);
    }));

  it("after the dinner time a new user gets 'link not valid'", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await makeReadOnly(db, dinnerId);
      const guest = await createAuthUser(db, "guest_1");
      await rpcErrorAs(db, guest, "join_by_token", [await tokenOf(db, dinnerId)], ERR.linkNotValid);
    }));

  it("a kicked user cannot open the link", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const kicked = await addGuest(db, dinnerId, "guest_1", "kicked");
      const error = await rpcErrorAs(
        db,
        kicked,
        "join_by_token",
        [await tokenOf(db, dinnerId)],
        ERR.blocked
      );
      expect(error.message).toBe("You can't join this request.");
      expect(await statusOf(db, dinnerId, kicked)).toEqual(["kicked"]);
    }));
});

describe("set_answer", () => {
  it("an invited guest accepts", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "guest_1", "invited");
      await rpcAs(db, guest, "set_answer", dinnerId, "accepted");
      expect(await statusOf(db, dinnerId, guest)).toEqual(["accepted"]);
    }));

  it("declining frees all roles in the same call", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const featureId = await addFeature(db, owner, dinnerId);
      const guest = await addGuest(db, dinnerId, "guest_1");
      await rpcAs(db, guest, "claim_role", featureId);

      await rpcAs(db, guest, "set_answer", dinnerId, "declined");
      expect(await roleCount(db, dinnerId, guest)).toBe(0);
      expect(await statusOf(db, dinnerId, guest)).toEqual(["declined"]);
    }));

  it("User 1 cannot change their own answer", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcErrorAs(db, owner, "set_answer", [dinnerId, "declined"], ERR.notAllowed);
    }));

  it("rejects an unknown answer, a non-participant and a kicked user", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "guest_1", "invited");
      const stranger = await createAuthUser(db, "stranger");
      const kicked = await addGuest(db, dinnerId, "guest_2", "kicked");

      await rpcErrorAs(db, guest, "set_answer", [dinnerId, "kicked"], ERR.invalid);
      await rpcErrorAs(db, stranger, "set_answer", [dinnerId, "accepted"], ERR.notFound);
      await rpcErrorAs(db, kicked, "set_answer", [dinnerId, "accepted"], ERR.notFound);
      expect(await statusOf(db, dinnerId, kicked)).toEqual(["kicked"]);
    }));

  it("an answer change after the dinner time is rejected", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "guest_1");
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, guest, "set_answer", [dinnerId, "declined"], ERR.readOnly);
      expect(await statusOf(db, dinnerId, guest)).toEqual(["accepted"]);
    }));
});

describe("add_feature", () => {
  it("User 1 adds a feature with 2 slots", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const featureId = await addFeature(db, owner, dinnerId, "dessert", 2);
      const { rows } = await db.query("select type, slots from public.features where id = $1", [
        featureId,
      ]);
      expect(rows).toEqual([{ type: "dessert", slots: 2 }]);
    }));

  it("a guest cannot add features, a stranger gets 'not found'", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "guest_1");
      const stranger = await createAuthUser(db, "stranger");
      await rpcErrorAs(db, guest, "add_feature", [dinnerId, "dessert", 2], ERR.notAllowed);
      await rpcErrorAs(db, stranger, "add_feature", [dinnerId, "dessert", 2], ERR.notFound);
    }));

  it("slots must be 1 to 30", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "dessert", 0], ERR.invalid);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "dessert", 31], ERR.invalid);
      expect(await addFeature(db, owner, dinnerId, "dessert", 30)).toBeTruthy();
    }));

  it("Host cannot be added again, Alcohol is refused until the age check exists", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "host", 1], ERR.invalid);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "alcohol", 2], ERR.invalid);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "pizza", 2], ERR.invalid);
    }));

  it("only Appetizer, Dessert and Snack can be added more than once", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      for (const type of ["appetizer", "dessert", "snack"]) {
        await addFeature(db, owner, dinnerId, type);
        await addFeature(db, owner, dinnerId, type);
      }
      for (const type of ["main_course", "soft_drinks", "grocery_shopping", "cleanup", "entertainment"]) {
        await addFeature(db, owner, dinnerId, type);
        await rpcErrorAs(db, owner, "add_feature", [dinnerId, type, 2], ERR.onlyOnce);
      }
    }));

  it("the database itself allows one Host and one Main course per dinner", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await addFeature(db, owner, dinnerId, "main_course");
      for (const type of ["host", "main_course"]) {
        await expectSqlError(
          db,
          "insert into public.features (dinner_id, type, slots) values ($1, $2, 1)",
          [dinnerId, type],
          "23505"
        );
      }
    }));

  it("adding a feature after the dinner time is rejected", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "dessert", 2], ERR.readOnly);
    }));
});

describe("claim_role and unclaim_role", () => {
  async function setup(db) {
    const owner = await createAuthUser(db, "owner_1");
    const dinnerId = await newDinner(db, owner);
    const dessert = await addFeature(db, owner, dinnerId, "dessert", 2);
    const guest = await addGuest(db, dinnerId, "guest_1");
    return { owner, dinnerId, dessert, guest };
  }

  it("an accepted guest claims a slot", () =>
    withRollback(async (db) => {
      const { dessert, guest } = await setup(db);
      await rpcAs(db, guest, "claim_role", dessert);
      expect(await roleHolders(db, dessert)).toEqual([guest]);
    }));

  it("a third role claim is rejected", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert, guest } = await setup(db);
      const snack = await addFeature(db, owner, dinnerId, "snack");
      const cleanup = await addFeature(db, owner, dinnerId, "cleanup");
      await rpcAs(db, guest, "claim_role", dessert);
      await rpcAs(db, guest, "claim_role", snack);

      const error = await rpcErrorAs(db, guest, "claim_role", [cleanup], ERR.roleLimit);
      expect(error.message).toBe("You can hold at most two roles.");
      expect(await roleCount(db, dinnerId, guest)).toBe(2);
    }));

  it("Host counts as one role for User 1", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert } = await setup(db);
      const snack = await addFeature(db, owner, dinnerId, "snack");
      await rpcAs(db, owner, "claim_role", dessert);
      await rpcErrorAs(db, owner, "claim_role", [snack], ERR.roleLimit);
    }));

  it("claiming a full feature is rejected", () =>
    withRollback(async (db) => {
      const { dinnerId, dessert, guest } = await setup(db);
      const guest2 = await addGuest(db, dinnerId, "guest_2");
      const guest3 = await addGuest(db, dinnerId, "guest_3");
      await rpcAs(db, guest, "claim_role", dessert);
      await rpcAs(db, guest2, "claim_role", dessert);

      const error = await rpcErrorAs(db, guest3, "claim_role", [dessert], ERR.full);
      expect(error.message).toBe("This feature is full.");
      expect(await roleHolders(db, dessert)).toHaveLength(2);
    }));

  it("one role per feature per user", () =>
    withRollback(async (db) => {
      const { dessert, guest } = await setup(db);
      await rpcAs(db, guest, "claim_role", dessert);
      await rpcErrorAs(db, guest, "claim_role", [dessert], ERR.alreadyHeld);
      expect(await roleHolders(db, dessert)).toEqual([guest]);
    }));

  it("two Desserts are two different roles", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert, guest } = await setup(db);
      const dessert2 = await addFeature(db, owner, dinnerId, "dessert");
      await rpcAs(db, guest, "claim_role", dessert);
      await rpcAs(db, guest, "claim_role", dessert2);
      expect(await roleCount(db, dinnerId, guest)).toBe(2);
    }));

  it("invited, declined and kicked guests and strangers cannot claim", () =>
    withRollback(async (db) => {
      const { dinnerId, dessert } = await setup(db);
      const invited = await addGuest(db, dinnerId, "invited_1", "invited");
      const declined = await addGuest(db, dinnerId, "declined_1", "declined");
      const kicked = await addGuest(db, dinnerId, "kicked_1", "kicked");
      const stranger = await createAuthUser(db, "stranger");

      await rpcErrorAs(db, invited, "claim_role", [dessert], ERR.notAccepted);
      await rpcErrorAs(db, declined, "claim_role", [dessert], ERR.notAccepted);
      await rpcErrorAs(db, kicked, "claim_role", [dessert], ERR.notFound);
      await rpcErrorAs(db, stranger, "claim_role", [dessert], ERR.notFound);
      expect(await roleHolders(db, dessert)).toEqual([]);
    }));

  it("a deleted feature gives a clear message", () =>
    withRollback(async (db) => {
      const { dessert, guest } = await setup(db);
      await db.query("delete from public.features where id = $1", [dessert]);
      const error = await rpcErrorAs(db, guest, "claim_role", [dessert], ERR.notFound);
      expect(error.message).toBe("This feature no longer exists.");
    }));

  it("a user removes their own role and the slot is free again", () =>
    withRollback(async (db) => {
      const { dinnerId, guest, dessert } = await setup(db);
      await db.query("update public.features set slots = 1 where id = $1", [dessert]);
      const guest2 = await addGuest(db, dinnerId, "guest_2");
      await rpcAs(db, guest, "claim_role", dessert);

      await rpcAs(db, guest, "unclaim_role", dessert);
      await rpcAs(db, guest, "unclaim_role", dessert); // a retry is harmless
      await rpcAs(db, guest2, "claim_role", dessert);
      expect(await roleHolders(db, dessert)).toEqual([guest2]);
    }));

  it("a user cannot remove someone else's role", () =>
    withRollback(async (db) => {
      const { owner, dessert, guest } = await setup(db);
      await rpcAs(db, guest, "claim_role", dessert);
      await rpcAs(db, owner, "unclaim_role", dessert);
      expect(await roleHolders(db, dessert)).toEqual([guest]);
    }));

  it("User 1 unselects Host and a guest can take it, one person only", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, guest } = await setup(db);
      const host = await hostFeature(db, dinnerId);
      const guest2 = await addGuest(db, dinnerId, "guest_2");

      await rpcErrorAs(db, guest, "claim_role", [host.id], ERR.full);
      await rpcAs(db, owner, "unclaim_role", host.id);
      await rpcAs(db, guest, "claim_role", host.id);
      await rpcErrorAs(db, guest2, "claim_role", [host.id], ERR.full);
      expect(await roleHolders(db, host.id)).toEqual([guest]);
    }));

  it("claim and unclaim after the dinner time are rejected", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert, guest } = await setup(db);
      await rpcAs(db, guest, "claim_role", dessert);
      await makeReadOnly(db, dinnerId);

      await rpcErrorAs(db, owner, "claim_role", [dessert], ERR.readOnly);
      await rpcErrorAs(db, guest, "unclaim_role", [dessert], ERR.readOnly);
      expect(await roleHolders(db, dessert)).toEqual([guest]);
    }));

  it("a role can only exist for a participant of the same dinner", () =>
    withRollback(async (db) => {
      const { dessert } = await setup(db);
      const owner2 = await createAuthUser(db, "owner_2");
      const otherDinner = await newDinner(db, owner2);
      const stranger = await createAuthUser(db, "stranger");
      // Wrong dinner for the feature, and a holder who is not a participant.
      for (const [dinnerId, userId] of [
        [otherDinner, owner2],
        [otherDinner, stranger],
      ]) {
        await expectSqlError(
          db,
          "insert into public.roles (feature_id, dinner_id, user_id) values ($1, $2, $3)",
          [dessert, dinnerId, userId],
          "23503"
        );
      }
    }));
});

describe("RLS on dinners, participants, features and roles", () => {
  const TABLES = ["dinners", "participants", "features", "roles"];

  async function setup(db) {
    const owner = await createAuthUser(db, "owner_1");
    const dinnerId = await newDinner(db, owner);
    const dessert = await addFeature(db, owner, dinnerId);
    const accepted = await addGuest(db, dinnerId, "accepted_1");
    await rpcAs(db, accepted, "claim_role", dessert);
    const invited = await addGuest(db, dinnerId, "invited_1", "invited");
    const declined = await addGuest(db, dinnerId, "declined_1", "declined");
    const kicked = await addGuest(db, dinnerId, "kicked_1", "kicked");
    const stranger = await createAuthUser(db, "stranger");
    return { owner, dinnerId, dessert, accepted, invited, declined, kicked, stranger };
  }

  async function visibleCounts(db, userId) {
    await actAs(db, userId);
    const counts = {};
    for (const table of TABLES) {
      const { rows } = await db.query(`select count(*)::int as n from public.${table}`);
      counts[table] = rows[0].n;
    }
    await db.query("reset role");
    return counts;
  }

  async function visibleUsers(db, userId, dinnerId) {
    await actAs(db, userId);
    const { rows } = await db.query(
      "select user_id from public.participants where dinner_id = $1",
      [dinnerId]
    );
    await db.query("reset role");
    return rows.map((r) => r.user_id).sort();
  }

  it("a user who is not a participant sees nothing", () =>
    withRollback(async (db) => {
      const { stranger } = await setup(db);
      expect(await visibleCounts(db, stranger)).toEqual({
        dinners: 0,
        participants: 0,
        features: 0,
        roles: 0,
      });
    }));

  it("a kicked user sees nothing, and the dinner leaves their list", () =>
    withRollback(async (db) => {
      const { kicked } = await setup(db);
      expect(await visibleCounts(db, kicked)).toEqual({
        dinners: 0,
        participants: 0,
        features: 0,
        roles: 0,
      });
    }));

  it("an invited guest can read the dinner, its features and roles", () =>
    withRollback(async (db) => {
      const { invited } = await setup(db);
      const counts = await visibleCounts(db, invited);
      expect(counts.dinners).toBe(1);
      expect(counts.features).toBe(2); // Host and Dessert
      expect(counts.roles).toBe(2); // User 1 as Host, the accepted guest on Dessert
    }));

  it("guests see accepted participants and themselves, not other declined or invited guests", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, accepted, invited, declined } = await setup(db);
      expect(await visibleUsers(db, accepted, dinnerId)).toEqual([owner, accepted].sort());
      expect(await visibleUsers(db, invited, dinnerId)).toEqual([owner, accepted, invited].sort());
      expect(await visibleUsers(db, declined, dinnerId)).toEqual(
        [owner, accepted, declined].sort()
      );
    }));

  it("User 1 sees every participant, including declined and kicked", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, accepted, invited, declined, kicked } = await setup(db);
      expect(await visibleUsers(db, owner, dinnerId)).toEqual(
        [owner, accepted, invited, declined, kicked].sort()
      );
    }));

  it("an anonymous visitor cannot read any of the tables", () =>
    withRollback(async (db) => {
      await setup(db);
      await actAs(db, null);
      for (const table of TABLES) {
        await expectSqlError(db, `select * from public.${table}`, [], PERMISSION_DENIED);
      }
    }));

  it("direct INSERT, UPDATE and DELETE from a client are denied", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert } = await setup(db);
      await actAs(db, owner);
      const attempts = [
        ["insert into public.dinners (owner_id, main_title, starts_at) values ($1, 'x', now())", [owner]],
        ["update public.dinners set main_title = 'x' where id = $1", [dinnerId]],
        ["delete from public.dinners where id = $1", [dinnerId]],
        ["update public.participants set status = 'accepted' where dinner_id = $1", [dinnerId]],
        ["insert into public.features (dinner_id, type, slots) values ($1, 'snack', 2)", [dinnerId]],
        ["update public.features set slots = 30 where id = $1", [dessert]],
        ["insert into public.roles (feature_id, dinner_id, user_id) values ($1, $2, $3)", [dessert, dinnerId, owner]],
        ["delete from public.roles where feature_id = $1", [dessert]],
      ];
      for (const [sql, params] of attempts) {
        await expectSqlError(db, sql, params, PERMISSION_DENIED);
      }
    }));

  it("clients cannot call the internal helpers", () =>
    withRollback(async (db) => {
      const { owner, dinnerId } = await setup(db);
      await rpcErrorAs(db, owner, "lock_dinner", [dinnerId], PERMISSION_DENIED);
      await rpcErrorAs(db, owner, "assert_not_read_only", [new Date()], PERMISSION_DENIED);
    }));
});

describe("dinner_people", () => {
  async function peopleAs(db, userId, dinnerId) {
    await actAs(db, userId);
    const { rows } = await db.query(
      "select user_id, username, display_name, status, is_owner from public.dinner_people($1)",
      [dinnerId]
    );
    await db.query("reset role");
    return rows;
  }

  it("guests see username and emoji, the name only for themselves", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "guest_1");
      const other = await addGuest(db, dinnerId, "guest_2");
      await db.query(
        "update public.profiles set display_name = 'Name ' || username where id in (select user_id from public.participants where dinner_id = $1)",
        [dinnerId]
      );

      const rows = await peopleAs(db, guest, dinnerId);
      expect(rows.map((r) => [r.username, r.display_name, r.is_owner])).toEqual([
        ["owner_1", null, true],
        ["guest_1", "Name guest_1", false],
        ["guest_2", null, false],
      ]);
      expect(rows.find((r) => r.user_id === other).status).toBe("accepted");
    }));

  it("User 1 sees every name and status", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await addGuest(db, dinnerId, "guest_1", "declined");
      await db.query(
        "update public.profiles set display_name = 'Name ' || username where id in (select user_id from public.participants where dinner_id = $1)",
        [dinnerId]
      );

      const rows = await peopleAs(db, owner, dinnerId);
      expect(rows.map((r) => [r.display_name, r.status])).toEqual([
        ["Name owner_1", "accepted"],
        ["Name guest_1", "declined"],
      ]);
    }));

  it("a stranger and a kicked user get no rows", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const kicked = await addGuest(db, dinnerId, "guest_1", "kicked");
      const stranger = await createAuthUser(db, "stranger");
      expect(await peopleAs(db, kicked, dinnerId)).toEqual([]);
      expect(await peopleAs(db, stranger, dinnerId)).toEqual([]);
    }));
});
