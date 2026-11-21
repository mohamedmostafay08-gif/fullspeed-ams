import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is dynamic (per-user data), so no incremental cache store is needed.
export default defineCloudflareConfig({});
