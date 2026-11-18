import { requireRole, STAFF } from "@/lib/auth";

export default async function TvLayout({ children }: LayoutProps<"/tv">) {
  await requireRole(...STAFF);
  return <div className="dark min-h-screen bg-[#060a14] text-white">{children}</div>;
}
