// Creates the first admin account.
// Usage: node --env-file=.env.local scripts/create-admin.mjs admin@company.com "StrongPass123" "الاسم"
import { createClient } from "@supabase/supabase-js";

const [email, password, fullName = "Admin"] = process.argv.slice(2);
if (!email || !password || password.length < 8) {
  console.error('Usage: node --env-file=.env.local scripts/create-admin.mjs <email> <password (8+ chars)> "<full name>"');
  process.exit(1);
}

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await db.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { full_name: fullName },
});
if (error) {
  console.error("Failed:", error.message);
  process.exit(1);
}

const { error: roleError } = await db.from("profiles").update({ role: "admin" }).eq("id", data.user.id);
if (roleError) {
  console.error("User created but promoting to admin failed:", roleError.message);
  process.exit(1);
}
console.log(`Admin ${email} created.`);
