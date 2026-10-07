import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { formatDinnerTime, isReadOnly } from "@/lib/dinners";
import { signOut } from "./login/actions";

const STATUS_LABELS = {
  invited: "Not answered",
  accepted: "Coming",
  declined: "Not coming",
};

function DinnerList({ dinners, statusByDinner }) {
  if (dinners.length === 0) return <p className="muted">None yet.</p>;
  return (
    <ul className="dinner-list">
      {dinners.map((d) => (
        <li key={d.id}>
          <Link href={`/dinners/${d.id}`} className="card dinner-link">
            <strong>{d.main_title}</strong>
            <span className="muted">
              {formatDinnerTime(d.starts_at)}
              {isReadOnly(d.starts_at) && " · over"}
              {statusByDinner && ` · ${STATUS_LABELS[statusByDinner.get(d.id)] ?? ""}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function HomePage() {
  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);
  if (!userId) redirect("/login");

  // RLS returns the caller's own profile, and only dinners they may see
  // (not kicked). Both lists are indexed by owner_id and user_id.
  const [{ data: profile }, { data: dinners }, { data: myRows }] = await Promise.all([
    supabase.from("profiles").select("username, display_name, emoji").eq("id", userId).maybeSingle(),
    supabase.from("dinners").select("id, owner_id, main_title, starts_at").order("starts_at"),
    supabase.from("participants").select("dinner_id, status").eq("user_id", userId),
  ]);

  const created = (dinners ?? []).filter((d) => d.owner_id === userId);
  const invited = (dinners ?? []).filter((d) => d.owner_id !== userId);
  const statusByDinner = new Map((myRows ?? []).map((r) => [r.dinner_id, r.status]));

  return (
    <main className="page narrow">
      <header className="stack">
        <h1>
          {profile?.emoji ? `${profile.emoji} ` : ""}
          {profile?.display_name || profile?.username || "Welcome"}
        </h1>
        {profile && <p className="muted">@{profile.username}</p>}
      </header>

      <Link href="/dinners/new" className="button primary">
        Create new dinner request
      </Link>

      <section className="stack">
        <h2>Dinners I have created</h2>
        <DinnerList dinners={created} />
      </section>

      <section className="stack">
        <h2>Dinners I have been invited to</h2>
        <DinnerList dinners={invited} statusByDinner={statusByDinner} />
      </section>

      <form action={signOut}>
        <button type="submit">Log out</button>
      </form>
    </main>
  );
}
