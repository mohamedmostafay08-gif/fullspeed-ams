import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { makeT, type Locale } from "./translate";

export type Theme = "system" | "light" | "dark";

export const getLocale = cache(async (): Promise<Locale> => ((await cookies()).get("lang")?.value === "en" ? "en" : "ar"));

export const getTheme = cache(async (): Promise<Theme> => {
  const v = (await cookies()).get("theme")?.value;
  return v === "light" || v === "dark" ? v : "system";
});

export async function getT() {
  return makeT(await getLocale());
}
