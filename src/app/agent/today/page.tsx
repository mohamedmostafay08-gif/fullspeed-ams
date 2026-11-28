import { redirect } from "next/navigation";

/** "شاشة اليوم" is now part of the agent home. Old links and bookmarks land there. */
export default function AgentToday() {
  redirect("/agent");
}
