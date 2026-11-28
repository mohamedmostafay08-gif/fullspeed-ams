// Shared by the proxy (edge) and the server code, so no server-only imports here.

/** httpOnly cookie "<viewer id>:<agent id>", set only by POST /api/view-as after an admin check. */
export const VIEW_AS_COOKIE = "ams_view_as";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseViewAs(value: string | undefined): { viewer: string; agent: string } | null {
  const [viewer, agent] = (value ?? "").split(":");
  return viewer && agent && UUID.test(viewer) && UUID.test(agent) ? { viewer, agent } : null;
}

export const VIEW_AS_READ_ONLY = "وضع العرض بس: مينفعش تعدّل حاجة وإنت شايف السيستم كأجنت. اخرج من وضع العرض الأول.";
