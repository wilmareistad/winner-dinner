// Concurrency on one dinner (docs/constraints.md, "What could go wrong").
// Parallel connections cannot see uncommitted data, so the setup is committed
// with random usernames and deleted afterwards. Deleting the users cascades to
// their dinners, participants and roles.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connect, createAuthUser, race, raceCall, rpcAs, uniqueUsername } from "./helpers";
import { ERR, addFeature, addGuest, newDinner, roleCount, roleHolders } from "./dinner-fixtures";

let db;
let userIds;

async function user(prefix) {
  const id = await createAuthUser(db, uniqueUsername(prefix));
  userIds.push(id);
  return id;
}

async function guest(dinnerId, prefix) {
  const id = await addGuest(db, dinnerId, uniqueUsername(prefix));
  userIds.push(id);
  return id;
}

// Builds the data in one transaction and commits it.
async function committed(build) {
  await db.query("begin");
  try {
    const result = await build();
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

function outcome(results) {
  return {
    ok: results.filter((r) => r.status === "fulfilled").length,
    errors: results.filter((r) => r.status === "rejected").map((r) => r.reason.code),
  };
}

beforeEach(async () => {
  db = await connect();
  userIds = [];
});

afterEach(async () => {
  try {
    await db.query("delete from auth.users where id = any($1)", [userIds]);
  } finally {
    await db.end();
  }
});

describe("races on one dinner", () => {
  it("last slot claimed by two users at once: exactly one succeeds", async () => {
    const { dessert, a, b } = await committed(async () => {
      const owner = await user("owner");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId, "dessert", 2);
      const first = await guest(dinnerId, "first");
      await rpcAs(db, first, "claim_role", dessert);
      return { dessert, a: await guest(dinnerId, "a"), b: await guest(dinnerId, "b") };
    });

    const results = await race([raceCall(a, "claim_role", dessert), raceCall(b, "claim_role", dessert)]);

    expect(outcome(results)).toEqual({ ok: 1, errors: [ERR.full] });
    expect(await roleHolders(db, dessert)).toHaveLength(2);
  });

  it("many users on two slots behave the same: exactly two succeed", async () => {
    const { dessert, guests } = await committed(async () => {
      const owner = await user("owner");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId, "dessert", 2);
      const guests = [];
      for (let i = 0; i < 5; i++) guests.push(await guest(dinnerId, `g${i}`));
      return { dessert, guests };
    });

    const results = await race(guests.map((g) => raceCall(g, "claim_role", dessert)));

    expect(outcome(results)).toEqual({ ok: 2, errors: [ERR.full, ERR.full, ERR.full] });
    expect(await roleHolders(db, dessert)).toHaveLength(2);
  });

  it("same user claims in two tabs at once: the third role fails", async () => {
    const { dinnerId, snack, cleanup, anna } = await committed(async () => {
      const owner = await user("owner");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId, "dessert");
      const snack = await addFeature(db, owner, dinnerId, "snack");
      const cleanup = await addFeature(db, owner, dinnerId, "cleanup");
      const anna = await guest(dinnerId, "anna");
      await rpcAs(db, anna, "claim_role", dessert);
      return { dinnerId, snack, cleanup, anna };
    });

    const results = await race([
      raceCall(anna, "claim_role", snack),
      raceCall(anna, "claim_role", cleanup),
    ]);

    expect(outcome(results)).toEqual({ ok: 1, errors: [ERR.roleLimit] });
    expect(await roleCount(db, dinnerId, anna)).toBe(2);
  });

  it("a guest declines while claiming: no role is left for a non-accepted guest", async () => {
    const { dinnerId, dessert, ben } = await committed(async () => {
      const owner = await user("owner");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId, "dessert");
      return { dinnerId, dessert, ben: await guest(dinnerId, "ben") };
    });

    // Either order is fine. The end state must never be "declined with a role".
    await race([
      raceCall(ben, "claim_role", dessert),
      raceCall(ben, "set_answer", dinnerId, "declined"),
    ]);

    const { rows } = await db.query(
      "select status from public.participants where dinner_id = $1 and user_id = $2",
      [dinnerId, ben]
    );
    expect(rows[0].status).toBe("declined");
    expect(await roleCount(db, dinnerId, ben)).toBe(0);
  });
});
