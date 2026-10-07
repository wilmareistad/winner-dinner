import Link from "next/link";
import { connection } from "next/server";
import { todayInStockholm } from "@/lib/dinners";
import NewDinnerForm from "./NewDinnerForm";

export const metadata = { title: "New dinner · WinnerDinner 2000" };

export default async function NewDinnerPage() {
  // Today's date must come from the request, not from the build.
  await connection();
  return (
    <main className="page narrow">
      <Link href="/">← My dinners</Link>
      <h1>New dinner request</h1>
      <NewDinnerForm minDate={todayInStockholm()} />
    </main>
  );
}
