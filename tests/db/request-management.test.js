// Milestone 2 rules: editing the request, the invite link switch, feature types,
// slots and removing features. Every test runs in a rolled-back transaction.
// Concurrency is covered in dinners-race.test.js.
import { describe, expect, it } from "vitest";
import { actAs, createAuthUser, expectSqlError, rpcAs, rpcErrorAs, withRollback } from "./helpers";
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

async function dinnerRow(db, dinnerId) {
  const { rows } = await db.query("select * from public.dinners where id = $1", [dinnerId]);
  return rows[0];
}

async function featureRow(db, featureId) {
  const { rows } = await db.query("select * from public.features where id = $1", [featureId]);
  return rows[0];
}

async function hostOf(db, dinnerId) {
  const { rows } = await db.query(
    "select id from public.features where dinner_id = $1 and type = 'host'",
    [dinnerId]
  );
  return rows[0].id;
}

async function noticesOf(db, userId) {
  const { rows } = await db.query(
    "select text from public.notices where user_id = $1 order by created_at",
    [userId]
  );
  return rows.map((r) => r.text);
}

// update_dinner(id, title, date, time, description, url, short, summary)
function editArgs(dinnerId, overrides = {}) {
  const v = {
    title: "Risotto",
    date: inDays(10),
    time: "18:30",
    description: "Mushroom",
    url: "https://example.com/risotto",
    short: "Bring wine",
    summary: "Welcome all!",
    ...overrides,
  };
  return [dinnerId, v.title, v.date, v.time, v.description, v.url, v.short, v.summary];
}

describe("create_dinner with an invitation summary", () => {
  it("stores the summary, trimmed, and an empty summary as null", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const a = await rpcAs(
        db, owner, "create_dinner", "Soup", inDays(7), "19:00", null, null, null, "  Hi all  "
      );
      const b = await rpcAs(db, owner, "create_dinner", "Soup", inDays(7), "19:00", null, null, null, " ");
      expect((await dinnerRow(db, a)).invitation_summary).toBe("Hi all");
      expect((await dinnerRow(db, b)).invitation_summary).toBeNull();
    }));

  it("rejects a summary over 1000 characters", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      await rpcErrorAs(
        db, owner, "create_dinner",
        ["Soup", inDays(7), "19:00", null, null, null, "x".repeat(1001)],
        ERR.invalid
      );
    }));
});

describe("update_dinner", () => {
  it("User 1 changes the main course, time, descriptions and summary", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcAs(db, owner, "update_dinner", ...editArgs(dinnerId, { date: "2099-01-15" }));

      const d = await dinnerRow(db, dinnerId);
      expect(d.main_title).toBe("Risotto");
      expect(d.main_description).toBe("Mushroom");
      expect(d.main_url).toBe("https://example.com/risotto");
      expect(d.short_description).toBe("Bring wine");
      expect(d.invitation_summary).toBe("Welcome all!");
      // 18:30 in Stockholm in winter is 17:30 UTC.
      expect(d.starts_at.toISOString()).toBe("2099-01-15T17:30:00.000Z");
    }));

  it("clears optional fields that are left empty", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcAs(db, owner, "update_dinner", ...editArgs(dinnerId));
      await rpcAs(
        db, owner, "update_dinner",
        ...editArgs(dinnerId, { description: "", url: " ", short: null, summary: "" })
      );
      const d = await dinnerRow(db, dinnerId);
      expect([d.main_description, d.main_url, d.short_description, d.invitation_summary]).toEqual([
        null, null, null, null,
      ]);
    }));

  it("the date cannot be moved into the past, and the title and link are checked", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const error = await rpcErrorAs(
        db, owner, "update_dinner", editArgs(dinnerId, { date: inDays(-2) }), ERR.invalid
      );
      expect(error.message).toBe("The dinner cannot be in the past.");
      await rpcErrorAs(db, owner, "update_dinner", editArgs(dinnerId, { title: " " }), ERR.invalid);
      await rpcErrorAs(
        db, owner, "update_dinner", editArgs(dinnerId, { url: "javascript:alert(1)" }), ERR.invalid
      );
      expect((await dinnerRow(db, dinnerId)).main_title).toBe("Lasagna");
    }));

  it("no guest, in any status, can change the main recipe; a stranger gets 'not found'", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      for (const status of ["invited", "accepted", "declined"]) {
        const guest = await addGuest(db, dinnerId, `guest_${status}`, status);
        await rpcErrorAs(db, guest, "update_dinner", editArgs(dinnerId), ERR.notAllowed);
      }
      const kicked = await addGuest(db, dinnerId, "guest_kicked", "kicked");
      await rpcErrorAs(db, kicked, "update_dinner", editArgs(dinnerId), ERR.notFound);
      const stranger = await createAuthUser(db, "stranger");
      await rpcErrorAs(db, stranger, "update_dinner", editArgs(dinnerId), ERR.notFound);
      await rpcErrorAs(db, null, "update_dinner", editArgs(dinnerId), PERMISSION_DENIED);
      expect((await dinnerRow(db, dinnerId)).main_title).toBe("Lasagna");
    }));

  it("editing after the dinner time is rejected", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "update_dinner", editArgs(dinnerId), ERR.readOnly);
    }));
});

describe("set_link_enabled", () => {
  it("turning the link off blocks new joins, existing guests keep access, on again works", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const existing = await addGuest(db, dinnerId, "guest_1");
      const token = await tokenOf(db, dinnerId);

      await rpcAs(db, owner, "set_link_enabled", dinnerId, false);
      const newcomer = await createAuthUser(db, "guest_2");
      await rpcErrorAs(db, newcomer, "join_by_token", [token], ERR.linkNotValid);
      expect(await rpcAs(db, existing, "join_by_token", token)).toBe(dinnerId);

      await rpcAs(db, owner, "set_link_enabled", dinnerId, true);
      expect(await rpcAs(db, newcomer, "join_by_token", token)).toBe(dinnerId);
    }));

  it("only User 1 can switch the link, and not after the dinner time", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const guest = await addGuest(db, dinnerId, "guest_1");
      await rpcErrorAs(db, guest, "set_link_enabled", [dinnerId, false], ERR.notAllowed);
      await rpcErrorAs(db, owner, "set_link_enabled", [dinnerId, null], ERR.invalid);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "set_link_enabled", [dinnerId, false], ERR.readOnly);
      expect((await dinnerRow(db, dinnerId)).link_enabled).toBe(true);
    }));
});

describe("add_feature: types, Alcohol, recipes and labels", () => {
  it("every type can be added; only Appetizer, Dessert and Snack more than once", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      for (const type of ["appetizer", "dessert", "snack"]) {
        await addFeature(db, owner, dinnerId, type);
        await addFeature(db, owner, dinnerId, type);
      }
      const once = ["main_course", "alcohol", "soft_drinks", "grocery_shopping", "cleanup", "entertainment"];
      for (const type of once) {
        await rpcAs(db, owner, "add_feature", dinnerId, type, 2, true);
        await rpcErrorAs(db, owner, "add_feature", [dinnerId, type, 2, true], ERR.onlyOnce);
      }
    }));

  it("Alcohol is added only with age_confirmed = true, and asked again after removal", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      for (const confirmed of [false, null]) {
        await rpcErrorAs(
          db, owner, "add_feature", [dinnerId, "alcohol", 2, confirmed], ERR.ageNotConfirmed
        );
      }
      const { rows } = await db.query(
        "select count(*)::int as n from public.features where dinner_id = $1 and type = 'alcohol'",
        [dinnerId]
      );
      expect(rows[0].n).toBe(0);

      const alcohol = await rpcAs(db, owner, "add_feature", dinnerId, "alcohol", 2, true);
      await rpcAs(db, owner, "remove_feature", alcohol, false);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "alcohol", 2], ERR.ageNotConfirmed);
    }));

  it("extra courses take an optional recipe title and link", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const a = await rpcAs(
        db, owner, "add_feature", dinnerId, "dessert", 2, false, " Tiramisu ", "https://ex.com/t"
      );
      const b = await rpcAs(db, owner, "add_feature", dinnerId, "snack", 1, false, "", " ");
      expect(await featureRow(db, a)).toMatchObject({
        recipe_title: "Tiramisu",
        recipe_url: "https://ex.com/t",
      });
      expect(await featureRow(db, b)).toMatchObject({ recipe_title: null, recipe_url: null });
    }));

  it("a recipe is refused on other types, and the link must be http(s)", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcErrorAs(db, owner, "add_feature", [dinnerId, "cleanup", 2, false, "Mop"], ERR.invalid);
      await rpcErrorAs(
        db, owner, "add_feature", [dinnerId, "main_course", 2, false, null, "https://ex.com"], ERR.invalid
      );
      await rpcErrorAs(
        db, owner, "add_feature", [dinnerId, "dessert", 2, false, "Cake", "javascript:x"], ERR.invalid
      );
      await rpcErrorAs(
        db, owner, "add_feature", [dinnerId, "dessert", 2, false, "x".repeat(101)], ERR.invalid
      );
    }));

  it("Entertainment takes an optional label; other types do not", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const ent = await rpcAs(
        db, owner, "add_feature", dinnerId, "entertainment", 4, false, null, null, "Karaoke"
      );
      expect((await featureRow(db, ent)).label).toBe("Karaoke");
      await rpcErrorAs(
        db, owner, "add_feature", [dinnerId, "dessert", 2, false, null, null, "Karaoke"], ERR.invalid
      );
      const other = await newDinner(db, owner);
      await rpcErrorAs(
        db, owner, "add_feature",
        [other, "entertainment", 2, false, null, null, "x".repeat(51)],
        ERR.invalid
      );
    }));

  it("the table itself refuses a label or recipe on the wrong type", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const attempts = [
        ["insert into public.features (dinner_id, type, slots, label) values ($1, 'cleanup', 1, 'x')"],
        ["insert into public.features (dinner_id, type, slots, recipe_title) values ($1, 'cleanup', 1, 'x')"],
        ["insert into public.features (dinner_id, type, slots, recipe_url) values ($1, 'dessert', 1, 'ftp://x')"],
      ];
      for (const [sql] of attempts) {
        await expectSqlError(db, sql, [dinnerId], "23514");
      }
    }));
});

describe("set_slots", () => {
  async function setup(db) {
    const owner = await createAuthUser(db, "owner_1");
    const dinnerId = await newDinner(db, owner);
    const dessert = await addFeature(db, owner, dinnerId, "dessert", 3);
    const a = await addGuest(db, dinnerId, "guest_a");
    const b = await addGuest(db, dinnerId, "guest_b");
    await rpcAs(db, a, "claim_role", dessert);
    await rpcAs(db, b, "claim_role", dessert);
    return { owner, dinnerId, dessert, a };
  }

  it("User 1 raises slots, and lowers them down to the filled count", () =>
    withRollback(async (db) => {
      const { owner, dessert } = await setup(db);
      await rpcAs(db, owner, "set_slots", dessert, 5);
      expect((await featureRow(db, dessert)).slots).toBe(5);
      await rpcAs(db, owner, "set_slots", dessert, 2);
      expect((await featureRow(db, dessert)).slots).toBe(2);
    }));

  it("lowering below the filled count is blocked with a message that shows the count", () =>
    withRollback(async (db) => {
      const { owner, dessert } = await setup(db);
      const error = await rpcErrorAs(db, owner, "set_slots", [dessert, 1], ERR.belowFilled);
      expect(error.message).toBe("2 of the slots are filled. You cannot go below 2.");
      expect((await featureRow(db, dessert)).slots).toBe(3);
    }));

  it("slots stay 1 to 30, and Host always has one slot", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert } = await setup(db);
      await rpcErrorAs(db, owner, "set_slots", [dessert, 31], ERR.invalid);
      await rpcErrorAs(db, owner, "set_slots", [dessert, null], ERR.invalid);
      await rpcErrorAs(db, owner, "set_slots", [await hostOf(db, dinnerId), 2], ERR.invalid);
    }));

  it("only User 1 can change slots, not after the dinner time, and not on a removed feature", () =>
    withRollback(async (db) => {
      const { owner, dinnerId, dessert, a } = await setup(db);
      await rpcErrorAs(db, a, "set_slots", [dessert, 10], ERR.notAllowed);
      const cleanup = await addFeature(db, owner, dinnerId, "cleanup");
      await rpcAs(db, owner, "remove_feature", cleanup, false);
      await rpcErrorAs(db, owner, "set_slots", [cleanup, 3], ERR.notFound);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "set_slots", [dessert, 10], ERR.readOnly);
    }));
});

describe("remove_feature", () => {
  it("a feature nobody holds is removed without confirmation", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      await rpcAs(db, owner, "remove_feature", dessert, false);
      expect(await featureRow(db, dessert)).toBeUndefined();
      // Removing it again is not an error, so a retry is safe.
      await rpcAs(db, owner, "remove_feature", dessert, false);
    }));

  it("a feature with roles needs confirmation, and nothing changes without it", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcAs(db, anna, "claim_role", dessert);

      const error = await rpcErrorAs(db, owner, "remove_feature", [dessert, false], ERR.confirmNeeded);
      expect(error.message).toBe("1 person holds this feature. Removing it also removes their roles.");
      expect(await roleHolders(db, dessert)).toEqual([anna]);
      expect(await noticesOf(db, anna)).toEqual([]);
    }));

  it("confirmed removal removes the roles and gives each holder, not User 1, a notice", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await rpcAs(db, owner, "create_dinner", "Lasagna", "2099-07-01", "19:00");
      const dessert = await rpcAs(db, owner, "add_feature", dinnerId, "dessert", 3, false, "Tiramisu");
      const anna = await addGuest(db, dinnerId, "anna_1");
      const ben = await addGuest(db, dinnerId, "ben_1");
      const carl = await addGuest(db, dinnerId, "carl_1");
      for (const id of [anna, ben, owner]) await rpcAs(db, id, "claim_role", dessert);

      // User 1 holds Host and Dessert. Host stays.
      expect(await roleCount(db, dinnerId, owner)).toBe(2);
      await rpcAs(db, owner, "remove_feature", dessert, true);

      expect(await featureRow(db, dessert)).toBeUndefined();
      expect(await roleCount(db, dinnerId, anna)).toBe(0);
      expect(await roleCount(db, dinnerId, owner)).toBe(1);
      const text = 'Dessert: Tiramisu was removed from "Lasagna" (1 July 2099, 19:00). Your role there is gone.';
      expect(await noticesOf(db, anna)).toEqual([text]);
      expect(await noticesOf(db, ben)).toEqual([text]);
      expect(await noticesOf(db, carl)).toEqual([]);
      expect(await noticesOf(db, owner)).toEqual([]);
    }));

  it("Host cannot be removed", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      await rpcErrorAs(db, owner, "remove_feature", [await hostOf(db, dinnerId), true], ERR.invalid);
    }));

  it("only User 1 can remove features, and not after the dinner time", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const guest = await addGuest(db, dinnerId, "guest_1");
      await rpcErrorAs(db, guest, "remove_feature", [dessert, true], ERR.notAllowed);
      const stranger = await createAuthUser(db, "stranger");
      await rpcErrorAs(db, stranger, "remove_feature", [dessert, true], ERR.notFound);
      await makeReadOnly(db, dinnerId);
      await rpcErrorAs(db, owner, "remove_feature", [dessert, true], ERR.readOnly);
      expect(await featureRow(db, dessert)).toBeDefined();
    }));
});

describe("Host", () => {
  it("User 1 unselects Host, an accepted guest takes it, and only one person holds it", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const host = await hostOf(db, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      const ben = await addGuest(db, dinnerId, "ben_1");
      const invited = await addGuest(db, dinnerId, "ivy_1", "invited");

      await rpcErrorAs(db, anna, "claim_role", [host], ERR.full);
      await rpcAs(db, owner, "unclaim_role", host);
      await rpcErrorAs(db, invited, "claim_role", [host], ERR.notAccepted);
      await rpcAs(db, anna, "claim_role", host);
      await rpcErrorAs(db, ben, "claim_role", [host], ERR.full);
      await rpcErrorAs(db, owner, "claim_role", [host], ERR.full);
      expect(await roleHolders(db, host)).toEqual([anna]);
    }));

  it("Host counts as one of a guest's two roles", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const host = await hostOf(db, dinnerId);
      const dessert = await addFeature(db, owner, dinnerId);
      const snack = await addFeature(db, owner, dinnerId, "snack");
      const anna = await addGuest(db, dinnerId, "anna_1");
      await rpcAs(db, owner, "unclaim_role", host);
      await rpcAs(db, anna, "claim_role", host);
      await rpcAs(db, anna, "claim_role", dessert);
      await rpcErrorAs(db, anna, "claim_role", [snack], ERR.roleLimit);
    }));
});

describe("RLS on notices", () => {
  it("a user reads only their own notices and cannot write any", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      const dinnerId = await newDinner(db, owner);
      const dessert = await addFeature(db, owner, dinnerId);
      const anna = await addGuest(db, dinnerId, "anna_1");
      const ben = await addGuest(db, dinnerId, "ben_1");
      await rpcAs(db, anna, "claim_role", dessert);
      await rpcAs(db, owner, "remove_feature", dessert, true);

      await actAs(db, anna);
      expect((await db.query("select user_id from public.notices")).rows).toEqual([{ user_id: anna }]);
      await actAs(db, ben);
      expect((await db.query("select * from public.notices")).rows).toEqual([]);
      await expectSqlError(
        db, "insert into public.notices (user_id, text) values ($1, 'x')", [ben], PERMISSION_DENIED
      );
      await expectSqlError(db, "delete from public.notices", [], PERMISSION_DENIED);
      await actAs(db, null);
      await expectSqlError(db, "select * from public.notices", [], PERMISSION_DENIED);
      await db.query("reset role");
    }));

  it("clients cannot call the new internal helpers", () =>
    withRollback(async (db) => {
      const owner = await createAuthUser(db, "owner_1");
      await rpcErrorAs(db, owner, "assert_dinner_owner", [owner], PERMISSION_DENIED);
      await rpcErrorAs(db, owner, "feature_name", ["dessert", null, null], PERMISSION_DENIED);
      await rpcErrorAs(
        db, owner, "check_dinner_fields",
        ["Soup", inDays(7), "19:00", null, null, null, null],
        PERMISSION_DENIED
      );
    }));
});
