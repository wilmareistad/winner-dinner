// Every test runs in a rolled-back transaction against the dev database.
import { describe, expect, it } from "vitest";
import {
  actAs,
  createAuthUser,
  expectSqlError,
  withRollback,
} from "./helpers";

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const INSUFFICIENT_PRIVILEGE = "42501";

describe("profiles", () => {
  it("creates a profile with the username when an auth user is created", () =>
    withRollback(async (db) => {
      const id = await createAuthUser(db, "anna_k");
      const { rows } = await db.query(
        "select username::text from public.profiles where id = $1",
        [id]
      );
      expect(rows).toEqual([{ username: "anna_k" }]);
    }));

  it("takes the username from the email in lowercase", () =>
    withRollback(async (db) => {
      const id = await createAuthUser(db, "Anna_K");
      const { rows } = await db.query(
        "select username::text from public.profiles where id = $1",
        [id]
      );
      expect(rows[0].username).toBe("anna_k");
    }));

  it("rejects a duplicate username, also with different capitalisation", () =>
    withRollback(async (db) => {
      await createAuthUser(db, "anna_k");
      await expectSqlError(
        db,
        "insert into auth.users (id, email) values (gen_random_uuid(), 'ANNA_K@users.winnerdinner.app')",
        [],
        UNIQUE_VIOLATION
      );
    }));

  it("rejects usernames outside 3-20 letters, digits and underscore", () =>
    withRollback(async (db) => {
      for (const bad of ["ab", "x".repeat(21), "anna-k", "an.na"]) {
        await expectSqlError(
          db,
          "insert into auth.users (id, email) values (gen_random_uuid(), $1)",
          [`${bad}@users.winnerdinner.app`],
          CHECK_VIOLATION
        );
      }
    }));

  it("rejects sign-up with a real email instead of a username", () =>
    withRollback(async (db) => {
      await expectSqlError(
        db,
        "insert into auth.users (id, email) values (gen_random_uuid(), 'anna@gmail.com')",
        [],
        CHECK_VIOLATION
      );
    }));

  it("blocks changing the email, so the username cannot drift", () =>
    withRollback(async (db) => {
      const id = await createAuthUser(db, "anna_k");
      await expectSqlError(
        db,
        "update auth.users set email = 'bob@users.winnerdinner.app' where id = $1",
        [id],
        CHECK_VIOLATION
      );
    }));

  it("deleting the auth user deletes the profile", () =>
    withRollback(async (db) => {
      const id = await createAuthUser(db, "anna_k");
      await db.query("delete from auth.users where id = $1", [id]);
      const { rowCount } = await db.query("select 1 from public.profiles where id = $1", [id]);
      expect(rowCount).toBe(0);
    }));

  it("a deleted username can be reused by a new account", () =>
    withRollback(async (db) => {
      const oldId = await createAuthUser(db, "anna_k");
      await db.query("delete from auth.users where id = $1", [oldId]);
      const newId = await createAuthUser(db, "anna_k");
      expect(newId).not.toBe(oldId);
    }));
});

describe("profiles RLS", () => {
  it("a user sees only their own profile", () =>
    withRollback(async (db) => {
      const anna = await createAuthUser(db, "anna_k");
      await createAuthUser(db, "ben_k");
      await actAs(db, anna);
      const { rows } = await db.query("select username::text from public.profiles");
      expect(rows).toEqual([{ username: "anna_k" }]);
    }));

  it("an anonymous visitor cannot read profiles", () =>
    withRollback(async (db) => {
      await createAuthUser(db, "anna_k");
      await actAs(db, null);
      await expectSqlError(db, "select * from public.profiles", [], INSUFFICIENT_PRIVILEGE);
    }));

  it("a client cannot insert, update or delete profiles directly", () =>
    withRollback(async (db) => {
      const anna = await createAuthUser(db, "anna_k");
      await actAs(db, anna);
      await expectSqlError(
        db,
        "insert into public.profiles (id, username) values (gen_random_uuid(), 'mallory')",
        [],
        INSUFFICIENT_PRIVILEGE
      );
      await expectSqlError(
        db,
        "update public.profiles set username = 'mallory' where id = $1",
        [anna],
        INSUFFICIENT_PRIVILEGE
      );
      await expectSqlError(
        db,
        "delete from public.profiles where id = $1",
        [anna],
        INSUFFICIENT_PRIVILEGE
      );
    }));
});
