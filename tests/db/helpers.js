import pg from "pg";
import { randomUUID } from "node:crypto";
import { dbConfig } from "../../scripts/db-config.mjs";
import { HIDDEN_EMAIL_DOMAIN } from "../../lib/auth.js";

export async function connect() {
  const client = new pg.Client(dbConfig());
  await client.connect();
  return client;
}

// Runs fn inside a transaction that is always rolled back, so tests leave no data.
export async function withRollback(fn) {
  const client = await connect();
  try {
    await client.query("begin");
    return await fn(client);
  } finally {
    await client.query("rollback").catch(() => {});
    await client.end();
  }
}

// Creates an auth user the same way Supabase does, which fires the profile trigger.
export async function createAuthUser(client, username, id = randomUUID()) {
  await client.query("insert into auth.users (id, email) values ($1, $2)", [
    id,
    `${username}@${HIDDEN_EMAIL_DOMAIN}`,
  ]);
  return id;
}

// Switches the transaction to the role and JWT claims PostgREST would use.
export async function actAs(client, userId) {
  await client.query("reset role");
  if (userId) {
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set local role authenticated");
  } else {
    await client.query("select set_config('request.jwt.claims', '{}', true)");
    await client.query("set local role anon");
  }
}

// Asserts that a query fails with the given SQLSTATE. Uses a savepoint so the
// surrounding transaction can continue.
export async function expectSqlError(client, sql, params, code) {
  await client.query("savepoint expect_error");
  try {
    await client.query(sql, params);
  } catch (error) {
    await client.query("rollback to savepoint expect_error");
    if (error.code !== code) {
      throw new Error(`Expected SQLSTATE ${code}, got ${error.code}: ${error.message}`);
    }
    return error;
  }
  throw new Error(`Expected SQLSTATE ${code}, but the query succeeded`);
}

function callSql(fn, argCount) {
  const placeholders = Array.from({ length: argCount }, (_, i) => `$${i + 1}`).join(", ");
  return `select public.${fn}(${placeholders}) as result`;
}

// Calls a database function as the user (null = anonymous), then switches back
// to the admin role so the test can set up and inspect data directly.
export async function rpcAs(client, userId, fn, ...args) {
  await actAs(client, userId);
  const { rows } = await client.query(callSql(fn, args.length), args);
  await client.query("reset role");
  return rows[0].result;
}

// Like rpcAs, but asserts that the call fails with the given SQLSTATE.
export async function rpcErrorAs(client, userId, fn, args, code) {
  await actAs(client, userId);
  const error = await expectSqlError(client, callSql(fn, args.length), args, code);
  await client.query("reset role");
  return error;
}

// For a race task: calls the function in the task's own transaction, holds the
// locks a moment so the competing tasks have to wait, then commits. Rolls back
// at once on error so a waiting task is never blocked by an aborted one.
export function raceCall(userId, fn, ...args) {
  return async (client) => {
    try {
      await actAs(client, userId);
      await client.query(callSql(fn, args.length), args);
      await client.query("select pg_sleep(0.2)");
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  };
}

// Random username for data that is committed, so parallel runs never collide.
// The prefix may be at most 11 characters.
export function uniqueUsername(prefix) {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

// Runs each task on its own connection at the same moment. Each task gets a client
// with an open transaction and decides itself whether to commit or roll back.
// Returns one { status, value | reason } per task, like Promise.allSettled.
export async function race(tasks) {
  const clients = await Promise.all(tasks.map(() => connect()));
  try {
    await Promise.all(clients.map((c) => c.query("begin")));
    return await Promise.allSettled(tasks.map((task, i) => task(clients[i])));
  } finally {
    await Promise.all(
      clients.map(async (c) => {
        await c.query("rollback").catch(() => {});
        await c.end();
      })
    );
  }
}
