import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createClient, getCurrentUserId } from "@/lib/supabase/server";
import {
  MAX_ROLES,
  formatDinnerTime,
  isReadOnly,
  isUuid,
  personLabel,
  stockholmDateTime,
  todayInStockholm,
} from "@/lib/dinners";
import AddFeatureForm from "./AddFeatureForm";
import AnswerForm from "./AnswerForm";
import CostSplit, { CostLine } from "./CostSplit";
import EditDinnerForm from "./EditDinnerForm";
import FeatureCard from "./FeatureCard";
import GuestManager from "./GuestManager";
import InviteLink from "./InviteLink";

export const metadata = { title: "Dinner · WinnerDinner 2000" };

async function inviteUrl(token) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}/invite/${token}`;
}

// One page for User 1 (admin view) and guests. Everything shown comes through
// RLS, so a kicked user or a stranger gets "Request not found".
export default async function DinnerPage({ params }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const supabase = await createClient();
  const userId = await getCurrentUserId(supabase);
  if (!userId) redirect(`/login?next=${encodeURIComponent(`/dinners/${id}`)}`);

  const [dinnerResult, featuresResult, rolesResult, peopleResult, costResult] = await Promise.all([
    supabase
      .from("dinners")
      .select(
        "id, owner_id, invite_token, link_enabled, main_title, main_url, main_description, starts_at, short_description, invitation_summary"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("features")
      .select("id, type, slots, label, recipe_title, recipe_url, created_at")
      .eq("dinner_id", id)
      .order("created_at"),
    supabase.from("roles").select("feature_id, user_id, created_at").eq("dinner_id", id).order("created_at"),
    supabase.rpc("dinner_people", { p_dinner_id: id }),
    // No row while cost split is off, so no amount can be shown.
    supabase.rpc("dinner_cost", { p_dinner_id: id }),
  ]);
  for (const result of [dinnerResult, featuresResult, rolesResult, peopleResult, costResult]) {
    if (result.error) throw new Error("Could not load the request.");
  }

  const dinner = dinnerResult.data;
  if (!dinner) notFound();

  const people = peopleResult.data;
  const cost = costResult.data[0] ?? null;
  const peopleById = new Map(people.map((p) => [p.user_id, p]));
  const me = peopleById.get(userId);
  const isOwner = dinner.owner_id === userId;
  const readOnly = isReadOnly(dinner.starts_at);
  const accepted = people.filter((p) => p.status === "accepted");
  const myRoleCount = rolesResult.data.filter((r) => r.user_id === userId).length;
  const canClaim = !readOnly && me?.status === "accepted" && myRoleCount < MAX_ROLES;

  return (
    <main className="page">
      <Link href="/">← My dinners</Link>

      <header className="stack">
        <p className="muted">{isOwner ? "Your request" : "You are invited"}</p>
        <h1>{dinner.main_title}</h1>
        <p>
          <strong>{formatDinnerTime(dinner.starts_at)}</strong>
        </p>
        {dinner.short_description && <p>{dinner.short_description}</p>}
        {dinner.main_description && <p className="muted">{dinner.main_description}</p>}
        {dinner.main_url && (
          <p>
            <a href={dinner.main_url} target="_blank" rel="noopener noreferrer">
              Recipe
            </a>
          </p>
        )}
      </header>

      {readOnly && (
        <p className="notice" role="status">
          This dinner has started. The request is read-only.
        </p>
      )}

      {dinner.invitation_summary && (
        <section className="card stack">
          <h2>Invitation</h2>
          <p className="pre-line">{dinner.invitation_summary}</p>
        </section>
      )}

      {isOwner && !readOnly && <CostSplit dinnerId={id} cost={cost} />}
      {cost && (!isOwner || readOnly) && (
        <section className="card stack">
          <h2>Cost</h2>
          <CostLine cost={cost} />
        </section>
      )}

      {isOwner && !readOnly && (
        <>
          <InviteLink
            dinnerId={id}
            url={await inviteUrl(dinner.invite_token)}
            enabled={dinner.link_enabled}
          />
          <EditDinnerForm
            dinnerId={id}
            minDate={todayInStockholm()}
            values={{ ...dinner, ...stockholmDateTime(dinner.starts_at) }}
          />
        </>
      )}

      {!isOwner && me && <AnswerForm dinnerId={id} status={me.status} readOnly={readOnly} />}

      <section className="stack">
        <h2>Features</h2>
        {me?.status !== "accepted" && (
          <p className="muted">Accept the invitation to take a role.</p>
        )}
        {me?.status === "accepted" && !readOnly && (
          <p className="muted">
            You hold {myRoleCount} of {MAX_ROLES} roles.
          </p>
        )}
        {featuresResult.data.map((feature) => {
          const holders = rolesResult.data
            .filter((r) => r.feature_id === feature.id)
            .map((r) => ({
              userId: r.user_id,
              label: personLabel(peopleById.get(r.user_id)),
              isMe: r.user_id === userId,
            }));
          const mine = holders.some((h) => h.isMe);
          return (
            <FeatureCard
              key={feature.id}
              dinnerId={id}
              feature={feature}
              holders={holders}
              canClaim={canClaim && !mine}
              canUnclaim={!readOnly && mine}
              canManage={isOwner && !readOnly}
            />
          );
        })}
        {isOwner && !readOnly && (
          <AddFeatureForm dinnerId={id} existingTypes={featuresResult.data.map((f) => f.type)} />
        )}
      </section>

      {isOwner && <GuestManager dinnerId={id} people={people} readOnly={readOnly} />}

      {!isOwner && me?.status === "accepted" && (
        <section className="stack">
          <h2>Who is coming ({accepted.length})</h2>
          <ul className="people">
            {accepted.map((p) => (
              <li key={p.user_id}>
                {personLabel(p)}
                {p.is_owner && <span className="muted"> · created the request</span>}
                {p.user_id === userId && <span className="muted"> · you</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
