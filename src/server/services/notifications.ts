import "server-only";
import { db } from "@/lib/supabase/admin";

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  createdAt: string;
  read: boolean;
}

/** Only in-app links to group pages are followed (no open redirects from stored data). */
function safeHref(data: unknown): string | null {
  const href = (data as { href?: unknown } | null)?.href;
  return typeof href === "string" && /^\/groups\/[0-9a-f-]{36}(\/[a-z]+)?(\?cycle=\d+)?$/i.test(href) ? href : null;
}

export async function listNotifications(userId: string, limit = 50): Promise<NotificationItem[]> {
  const { data, error } = await db()
    .from("notifications")
    .select("id, type, title, body, data, created_at, read_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; type: string; title: string; body: string; data: unknown; created_at: string; read_at: string | null }[]>();
  if (error) throw new Error(`notifications: ${error.message}`);
  return data.map((n) => ({
    id: n.id,
    type: n.type,
    title: n.title,
    body: n.body,
    href: safeHref(n.data),
    createdAt: n.created_at,
    read: n.read_at !== null,
  }));
}

export async function countUnread(userId: string): Promise<number> {
  const { count, error } = await db()
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (error) throw new Error(`unread: ${error.message}`);
  return count ?? 0;
}
