import { redirect } from "next/navigation";
import { NO_PROFILE_URL, getProfile } from "@/lib/auth";

export default async function Home() {
  const profile = await getProfile();
  if (!profile) redirect(NO_PROFILE_URL);
  redirect(profile.role === "agent" ? "/agent" : "/admin");
}
