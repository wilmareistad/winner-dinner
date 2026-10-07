// Runs `supabase db <command>` against the dev database without printing the password.
// Usage: npm run db:push -- --dry-run
import { spawnSync } from "node:child_process";
import { dbUrl } from "./db-config.mjs";

const args = ["supabase", "db", ...process.argv.slice(2), "--db-url", dbUrl()];
const result = spawnSync("npx", args, { stdio: "inherit" });
process.exit(result.status ?? 1);
