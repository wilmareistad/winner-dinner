import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { DB_ERRORS } from "@/lib/dinners";
import AuthForm from "@/app/login/AuthForm";

export const metadata = { title: "Invitation · WinnerDinner 2000" };

// Anonymous visitors see only the invitation and the login form, no dinner data.
// After login they come back here by a relative path and join.
export default async function InvitePage({ params }) {
  const { token } = await params;
  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);

  if (!userId) {
    return (
      <main className="page narrow">
        <h1>You have been invited</h1>
        <p className="muted">Log in or create an account to see the dinner.</p>
        <AuthForm next={`/invite/${encodeURIComponent(token)}`} />
      </main>
    );
  }

  const { data: dinnerId, error } = await supabase.rpc("join_by_token", { p_token: token });
  if (!error) redirect(`/dinners/${dinnerId}`);

  const blocked = error.code === DB_ERRORS.blocked;
  return (
    <main className="page narrow">
      <h1>{blocked ? "You can't join this request" : "This link is not valid"}</h1>
      <p className="muted">
        {blocked
          ? "The creator of the request has removed you."
          : "The link may be wrong, turned off, or the dinner is over."}
      </p>
      <Link href="/">Go to my dinners</Link>
    </main>
  );
}
