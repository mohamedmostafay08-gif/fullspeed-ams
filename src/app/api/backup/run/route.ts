import { fromDatabase } from "@/lib/app-config";
import { runBackup } from "@/lib/backup";

export const maxDuration = 60;

/** Nightly backup, triggered by the database scheduler (pg_cron → pg_net). */
export async function POST(request: Request) {
  if (!(await fromDatabase(request))) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    return Response.json(await runBackup());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "backup failed" }, { status: 500 });
  }
}
