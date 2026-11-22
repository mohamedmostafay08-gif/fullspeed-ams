import { requireRole, VIEWERS } from "@/lib/auth";

export default async function TvLayout({ children }: LayoutProps<"/tv">) {
  await requireRole(...VIEWERS);
  return <div className="dark min-h-screen bg-[#060a14] text-white">{children}</div>;
}
