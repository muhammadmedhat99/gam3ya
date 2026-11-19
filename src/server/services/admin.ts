import "server-only";
import { db } from "@/lib/supabase/admin";
import { requireSuperAdmin } from "@/server/auth/dal";

/** Super-admin read model. Every function re-checks the caller (404 for everyone else). */

export interface PlatformStats {
  users: number;
  blocked: number;
  groups: Record<"draft" | "active" | "completed" | "cancelled", number>;
}

export async function platformStats(): Promise<PlatformStats> {
  await requireSuperAdmin();
  const count = async (table: string, filter?: [string, string]) => {
    let q = db().from(table).select("id", { count: "exact", head: true });
    if (filter) q = q.eq(filter[0], filter[1]);
    if (table === "groups") q = q.is("deleted_at", null);
    const { count: n, error } = await q;
    if (error) throw new Error(`stats ${table}: ${error.message}`);
    return n ?? 0;
  };
  const [users, blocked, draft, active, completed, cancelled] = await Promise.all([
    count("users"),
    count("users", ["status", "blocked"]),
    count("groups", ["status", "draft"]),
    count("groups", ["status", "active"]),
    count("groups", ["status", "completed"]),
    count("groups", ["status", "cancelled"]),
  ]);
  return { users, blocked, groups: { draft, active, completed, cancelled } };
}

export interface AdminUserView {
  id: string;
  fullName: string;
  phone: string;
  email: string | null;
  status: "active" | "blocked";
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  tempPasswordExpiresAt: string | null;
  lockedUntil: string | null;
  createdAt: string;
  groups: { id: string; name: string; role: string }[];
  pendingRequests: number;
}

export async function findUserByPhone(phone: string): Promise<AdminUserView | null> {
  await requireSuperAdmin();
  const { data: u, error } = await db()
    .from("users")
    .select(
      "id, full_name, phone_e164, email, status, is_super_admin, must_change_password, temp_password_expires_at, locked_until, created_at",
    )
    .eq("phone_e164", phone)
    .maybeSingle<{
      id: string;
      full_name: string;
      phone_e164: string;
      email: string | null;
      status: "active" | "blocked";
      is_super_admin: boolean;
      must_change_password: boolean;
      temp_password_expires_at: string | null;
      locked_until: string | null;
      created_at: string;
    }>();
  if (error) throw new Error(`find user: ${error.message}`);
  if (!u) return null;

  const [rolesRes, membersRes, pendingRes] = await Promise.all([
    db().from("group_roles").select("role, groups!inner(id, name)").eq("user_id", u.id).is("groups.deleted_at", null)
      .returns<{ role: string; groups: { id: string; name: string } }[]>(),
    db().from("group_members").select("groups!inner(id, name)").eq("user_id", u.id).eq("status", "active").is("groups.deleted_at", null)
      .returns<{ groups: { id: string; name: string } }[]>(),
    db().from("member_link_requests").select("id", { count: "exact", head: true }).eq("user_id", u.id).eq("status", "pending"),
  ]);
  if (rolesRes.error) throw new Error(`user roles: ${rolesRes.error.message}`);
  if (membersRes.error) throw new Error(`user groups: ${membersRes.error.message}`);

  const groups = new Map<string, { id: string; name: string; role: string }>();
  for (const m of membersRes.data) groups.set(m.groups.id, { ...m.groups, role: "member" });
  for (const r of rolesRes.data) groups.set(r.groups.id, { ...r.groups, role: r.role });

  return {
    id: u.id,
    fullName: u.full_name,
    phone: u.phone_e164,
    email: u.email,
    status: u.status,
    isSuperAdmin: u.is_super_admin,
    mustChangePassword: u.must_change_password,
    tempPasswordExpiresAt: u.temp_password_expires_at,
    lockedUntil: u.locked_until,
    createdAt: u.created_at,
    groups: [...groups.values()],
    pendingRequests: pendingRes.count ?? 0,
  };
}

export interface ActivityItem {
  id: string;
  action: string;
  actor: string | null;
  group: string | null;
  createdAt: string;
}

export async function recentActivity(limit = 30): Promise<ActivityItem[]> {
  await requireSuperAdmin();
  const { data, error } = await db()
    .from("activity_logs")
    .select("id, action, created_at, users!activity_logs_actor_user_id_fkey(full_name), groups(name)")
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; action: string; created_at: string; users: { full_name: string } | null; groups: { name: string } | null }[]>();
  if (error) throw new Error(`activity: ${error.message}`);
  return data.map((a) => ({
    id: a.id,
    action: a.action,
    actor: a.users?.full_name ?? null,
    group: a.groups?.name ?? null,
    createdAt: a.created_at,
  }));
}
