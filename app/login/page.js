import { redirect } from "next/navigation";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth";
import AuthForm from "./AuthForm";

export const metadata = { title: "Log in · WinnerDinner 2000" };

export default async function LoginPage({ searchParams }) {
  const next = safeNextPath((await searchParams).next);

  const supabase = await createClient();
  if (await getCurrentUserId(supabase)) redirect(next);

  return (
    <main className="page narrow">
      <h1>WinnerDinner 2000</h1>
      <p className="muted">Share the work of a dinner between friends.</p>
      <AuthForm next={next} />
    </main>
  );
}
