"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";

const YEAR = 60 * 60 * 24 * 365;

export async function setLocale(locale: "ar" | "en") {
  (await cookies()).set("lang", locale === "en" ? "en" : "ar", { maxAge: YEAR, path: "/", sameSite: "lax" });
  revalidatePath("/", "layout");
}

export async function setTheme(theme: "system" | "light" | "dark") {
  (await cookies()).set("theme", ["light", "dark"].includes(theme) ? theme : "system", { maxAge: YEAR, path: "/", sameSite: "lax" });
  // The page already switched on the client; nothing on the server renders differently.
}
