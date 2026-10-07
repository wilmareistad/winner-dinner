import Link from "next/link";

export default function DinnerNotFound() {
  return (
    <main className="page narrow">
      <h1>Request not found</h1>
      <p className="muted">It may have been deleted, or you do not have access to it.</p>
      <Link href="/">Go to my dinners</Link>
    </main>
  );
}
