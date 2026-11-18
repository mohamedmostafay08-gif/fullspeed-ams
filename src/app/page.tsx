import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ShellSkeleton } from "@/components/app-shell";
import { getProfile } from "@/lib/auth";

export default function Home() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <RoleRedirect />
    </Suspense>
  );
}

async function RoleRedirect(): Promise<never> {
  const profile = await getProfile();
  if (!profile) redirect("/login");
  redirect(profile.role === "agent" ? "/agent" : "/admin");
}
