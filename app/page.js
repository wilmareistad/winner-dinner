import { redirect } from "next/navigation";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { signOut } from "./login/actions";

export default async function HomePage() {
  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);
  if (!userId) redirect("/login");

  // RLS only returns the caller's own profile row.
  const { data: profile } = await supabase
    .from("profiles")
    .select("username, display_name, emoji")
    .eq("id", userId)
    .maybeSingle();

  return (
    <main className="page narrow">
      <h1>
        {profile?.emoji ? `${profile.emoji} ` : ""}
        {profile?.display_name || profile?.username || "Welcome"}
      </h1>
      {profile && <p className="muted">@{profile.username}</p>}
      <form action={signOut}>
        <button type="submit">Log out</button>
      </form>
    </main>
  );
}
