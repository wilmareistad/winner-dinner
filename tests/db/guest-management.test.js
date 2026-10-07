// Milestone 3 rules: answers, kick, re-add and the 30-guest limit. Every test runs
// in a rolled-back transaction. Concurrency is covered in dinners-race.test.js.
import { describe, expect, it } from "vitest";
import { actAs, createAuthUser, expectSqlError, rpcAs, rpcErrorAs, withRollback } from "./helpers";
import {
  ERR,
  PERMISSION_DENIED,
  addFeature,
  addGuest,
  bulkAcceptedGuests,
  makeReadOnly,
  newDinner,
  roleCount,
  statusOf,
  tokenOf,
} from "./dinner-fixtures";

function acceptedGuests(db, dinnerId, n) {
  return bulkAcceptedGuests(db, dinnerId, n);
}

async function visibleDinners(db, userId) {
  await actAs(db, userId);
  const { rows } = await db.query("select id from public.dinners");
  await db.query("reset role");
  return rows.map((r) => r.id);
}

describe("answers", () => {
  it("declining frees all roles; the guest can change back to yes", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const snack = await addFeature(db, owner, dinnerId, "snack");
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcAs(db, anna, "claim_role", dessert);
      await rpcAs(db, anna, "claim_role", snack);

      await rpcAs(db, anna, "set_answer", dinnerId, "declined");
      expect(await roleCount(db, dinnerId, anna)).toBe(0);
      await rpcAs(db, anna, "set_answer", dinnerId, "accepted");
      expect(await statusOf(db, dinnerId, anna)).toBe("accepted");
      expect(await roleCount(db, dinnerId, anna)).toBe(0);
    }));

  it("a declined guest cannot claim until they accept again", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const ben = await addGuest(db, dinnerId, "ben_1", "declined");
      await rpcErrorAs(db, ben, "claim_role", [dessert], ERR.notAccepted);
      await rpcAs(db, ben, "set_answer", dinnerId, "accepted");
      await rpcAs(db, ben, "claim_role", dessert);
    }));

  it("a declined guest who opens the link lands on the request, no new row", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const ben = await addGuest(db, dinnerId, "ben_1", "declined");
      expect(await rpcAs(db, ben, "join_by_token", await tokenOf(db, dinnerId))).toBe(dinnerId);
      const { rows } = await db.query(
        "select status from public.participants where dinner_id = $1 and user_id = $2",
        [dinnerId, ben]
      );
      expect(rows).toEqual([{ status: "declined" }]);
    }));
});

describe("30-guest limit", () => {
  it("the 31st guest cannot accept; User 1 is not counted", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await acceptedGuests(db, dinnerId, 30);
      const late = await addGuest(db, dinnerId, "late_1", "invited");

      const error = await rpcErrorAs(db, late, "set_answer", [dinnerId, "accepted"], ERR.requestFull);
      expect(error.message).toBe("This request is full. 30 guests are already coming.");
      expect(await statusOf(db, dinnerId, late)).toBe("invited");
      // Declining is always possible, and an accepted guest re-accepting is a no-op.
      await rpcAs(db, late, "set_answer", dinnerId, "declined");
    }));

  it("invited and declined guests do not count", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      for (let i = 0; i < 3; i++) await addGuest(db, dinnerId, `inv_${i}`, "invited");
      for (let i = 0; i < 3; i++) await addGuest(db, dinnerId, `dec_${i}`, "declined");
      const accepted = await acceptedGuests(db, dinnerId, 29);
      const last = await addGuest(db, dinnerId, "last_1");
      expect(await statusOf(db, dinnerId, last)).toBe("accepted");
      expect(accepted).toHaveLength(29);
    }));

  it("declined back to accepted is subject to the limit, and a freed place can be taken", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const ben = await addGuest(db, dinnerId, "ben_1", "declined");
      const guests = await acceptedGuests(db, dinnerId, 30);
      await rpcErrorAs(db, ben, "set_answer", [dinnerId, "accepted"], ERR.requestFull);
      await rpcAs(db, guests[0], "set_answer", dinnerId, "declined");
      await rpcAs(db, ben, "set_answer", dinnerId, "accepted");
      expect(await statusOf(db, dinnerId, ben)).toBe("accepted");
    }));

  it("an accepted guest answering yes again is not refused when the request is full", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guests = await acceptedGuests(db, dinnerId, 30);
      await rpcAs(db, guests[5], "set_answer", dinnerId, "accepted");
    }));
});

describe("kick_guest", () => {
  async function setup(db) {
    const owner = await createAuthUser(db, "owner_1");
    const dinnerId = await newDinner(db, owner);
    const dessert = await addFeature(db, owner, dinnerId);
    const ben = await addGuest(db, dinnerId, "ben_1");
    await rpcAs(db, ben, "claim_role", dessert);
    return { owner, dinnerId, dessert, ben };
  }

  it("kick frees roles at once and gives no notice", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, ben } = await setup(db);
      await rpcAs(db, owner, "kick_guest", dinnerId, ben);
      expect(await statusOf(db, dinnerId, ben)).toBe("kicked");
      expect(await roleCount(db, dinnerId, ben)).toBe(0);
      const { rows } = await db.query("select * from public.notices where user_id = $1", [ben]);
      expect(rows).toEqual([]);
    }));

  it("a kicked user cannot open the link or the request, and the dinner leaves their list", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert, ben } = await setup(db);
      await rpcAs(db, owner, "kick_guest", dinnerId, ben);
      const error = await rpcErrorAs(
        db, ben, "join_by_token", [await tokenOf(db, dinnerId)], ERR.blocked
      );
      expect(error.message).toBe("You can't join this request.");
      expect(await visibleDinners(db, ben)).toEqual([]);
      await rpcErrorAs(db, ben, "set_answer", [dinnerId, "accepted"], ERR.notFound);
      await rpcErrorAs(db, ben, "claim_role", [dessert], ERR.notFound);
    }));

  it("invited and declined guests can be kicked; kicking twice is not an error", () =>
    withRollback(async (db) => {
      const { owner, dinnerId } = await setup(db);
      const ivy = await addGuest(db, dinnerId, "ivy_1", "invited");
      const dan = await addGuest(db, dinnerId, "dan_1", "declined");
      await rpcAs(db, owner, "kick_guest", dinnerId, ivy);
      await rpcAs(db, owner, "kick_guest", dinnerId, dan);
      await rpcAs(db, owner, "kick_guest", dinnerId, dan);
      expect([await statusOf(db, dinnerId, ivy), await statusOf(db, dinnerId, dan)]).toEqual([
        "kicked",
        "kicked",
      ]);
    }));

  it("User 1 cannot kick themselves; a non-participant gives 'not on the request'", () =>
    withRollback(async (db) => {
      const { owner, dinnerId } = await setup(db);
      await rpcErrorAs(db, owner, "kick_guest", [dinnerId, owner], ERR.invalid);
      const stranger = await createAuthUser(db, "stranger");
      await rpcErrorAs(db, owner, "kick_guest", [dinnerId, stranger], ERR.notFound);
    }));

  it("only User 1 can kick, and not after the dinner time", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, ben } = await setup(db);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcErrorAs(db, anna, "kick_guest", [dinnerId, ben], ERR.notAllowed);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "kick_guest", [dinnerId, ben], ERR.readOnly);
      expect(await statusOf(db, dinnerId, ben)).toBe("accepted");
    }));
});

describe("readd_guest", () => {
  async function setup(db) {
    const owner = await createAuthUser(db, "owner_1");
    const dinnerId = await newDinner(db, owner);
    const ben = await addGuest(db, dinnerId, "ben_k", "kicked");
    return { owner, dinnerId, ben };
  }

  it("User 1 re-adds a kicked guest by username; they return invited with no roles", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, ben } = await setup(db);
      expect(await rpcAs(db, owner, "readd_guest", dinnerId, " BEN_K ")).toBe(ben);
      expect(await statusOf(db, dinnerId, ben)).toBe("invited");
      expect(await roleCount(db, dinnerId, ben)).toBe(0);
      expect(await visibleDinners(db, ben)).toEqual([dinnerId]);
      expect(await rpcAs(db, ben, "join_by_token", await tokenOf(db, dinnerId))).toBe(dinnerId);
    }));

  it("the search covers only this dinner's kicked guests", () =>
    withRollback(async (db) => {
      const { owner, dinnerId } = await setup(db);
      await addGuest(db, dinnerId, "anna_1");
      await createAuthUser(db, "stranger");
      const other = await newDinner(db, owner);
      await addGuest(db, other, "kicked_elsewhere", "kicked");
      for (const name of ["anna_1", "stranger", "kicked_elsewhere", "", null]) {
        const error = await rpcErrorAs(db, owner, "readd_guest", [dinnerId, name], ERR.notFound);
        expect(error.message).toBe("No removed guest with that username.");
      }
    }));

  it("a re-added guest must accept again, and the limit is checked then", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, ben } = await setup(db);
      await acceptedGuests(db, dinnerId, 30);
      await rpcAs(db, owner, "readd_guest", dinnerId, "ben_k");
      await rpcErrorAs(db, ben, "set_answer", [dinnerId, "accepted"], ERR.requestFull);
    }));

  it("only User 1 can re-add, and not after the dinner time", () =>
    withRollback(async (db) => {
      const { owner, dinnerId } = await setup(db);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcErrorAs(db, anna, "readd_guest", [dinnerId, "ben_k"], ERR.notAllowed);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "readd_guest", [dinnerId, "ben_k"], ERR.readOnly);
    }));
});

describe("roles exist only for accepted participants (table rule)", () => {
  it("a role cannot be inserted for a guest who is not accepted, even directly", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      for (const status of ["invited", "declined", "kicked"]) {
        const id = await addGuest(db, dinnerId, `guest_${status}`, status);
        await expectSqlError(
          db,
          "insert into public.roles (feature_id, dinner_id, user_id) values ($1, $2, $3)",
          [dessert, dinnerId, id],
          ERR.notAccepted
        );
      }
    }));

  it("any status change away from accepted frees the roles", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcAs(db, anna, "claim_role", dessert);
      await db.query(
        "update public.participants set status = 'invited' where dinner_id = $1 and user_id = $2",
        [dinnerId, anna]
      );
      expect(await roleCount(db, dinnerId, anna)).toBe(0);
    }));

  it("clients cannot call the new internal helpers", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      await actAs(db, owner);
      await expectSqlError(
        db,
        "select public.assert_guest_room(d) from public.dinners d",
        [],
        PERMISSION_DENIED
      );
      await db.query("reset role");
    }));
});
