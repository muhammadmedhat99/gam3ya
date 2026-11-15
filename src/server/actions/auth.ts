"use server";

import { redirect } from "next/navigation";
import { hashPassword, verifyAgainstDummy, verifyPassword } from "@/lib/auth/password";
import { db } from "@/lib/supabase/admin";
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
  type ChangePasswordInput,
  type LoginInput,
  type RegisterInput,
} from "@/lib/validation/auth";
import { requireUser } from "@/server/auth/dal";
import {
  clientIpHash,
  isIpLoginLimited,
  isRegisterRateLimited,
  phoneLoginState,
  recordAttempt,
  syncUserLock,
} from "@/server/auth/rate-limit";
import { createSession, destroyCurrentSession, revokeOtherSessions } from "@/server/auth/session";
import {
  fromZodError,
  type ActionError,
  type LoginResult,
  type RegisterResult,
} from "./result";

const PHONE_TAKEN = "الرقم ده عليه حساب بالفعل";

export async function registerAction(input: RegisterInput): Promise<RegisterResult> {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { fullName, phone, password } = parsed.data;

  const ipHash = await clientIpHash();
  if (await isRegisterRateLimited(ipHash)) {
    return { error: "محاولات تسجيل كتير من الجهاز ده. جرّب بعد ربع ساعة." };
  }

  // The super admin's phone is reserved for bootstrap_super_admin (AGENTS.md → Super admin).
  if (phone === process.env.SUPER_ADMIN_PHONE) {
    return { fieldErrors: { phone: PHONE_TAKEN }, phoneTaken: true };
  }

  // Creates the user and, atomically, pending link requests for any association
  // that already added this phone. Nothing is linked until an admin approves.
  const { data: userId, error } = await db().rpc("register_user", {
    p_full_name: fullName,
    p_phone_e164: phone,
    p_password_hash: await hashPassword(password),
  });

  await recordAttempt(phone, ipHash, "register", !error);
  if (error) {
    if (error.code === "23505") return { fieldErrors: { phone: PHONE_TAKEN }, phoneTaken: true };
    throw new Error(`register failed: ${error.message}`);
  }

  await createSession(userId as string);
  redirect("/");
}

interface LoginUserRow {
  id: string;
  password_hash: string;
  status: "active" | "blocked";
  must_change_password: boolean;
  temp_password_expires_at: string | null;
  locked_until: string | null;
}

export async function loginAction(input: LoginInput): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { kind: "error", message: "رقم الموبايل أو كلمة السر غلط" };
  const { phone, password } = parsed.data;

  const before = await phoneLoginState(phone);
  if (before.lockedUntil) return { kind: "locked", until: before.lockedUntil.toISOString() };

  const ipHash = await clientIpHash();
  if (await isIpLoginLimited(ipHash)) {
    return { kind: "error", message: "محاولات كتير من الجهاز ده. استنى ربع ساعة وجرب تاني." };
  }

  const { data: user, error } = await db()
    .from("users")
    .select("id, password_hash, status, must_change_password, temp_password_expires_at, locked_until")
    .eq("phone_e164", phone)
    .maybeSingle<LoginUserRow>();
  if (error) throw new Error(`login lookup failed: ${error.message}`);

  if (user?.locked_until && new Date(user.locked_until) > new Date()) {
    return { kind: "locked", until: user.locked_until };
  }

  const passwordOk = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyAgainstDummy(password);

  if (!user || !passwordOk) {
    await recordAttempt(phone, ipHash, "login", false);
    const after = await phoneLoginState(phone);
    if (user) await syncUserLock(user.id, after);
    return after.lockedUntil
      ? { kind: "locked", until: after.lockedUntil.toISOString() }
      : { kind: "invalid", attemptsLeft: after.attemptsLeft };
  }

  if (user.status !== "active") {
    await recordAttempt(phone, ipHash, "login", false);
    return { kind: "error", message: "الحساب ده موقوف. كلّم صاحب التطبيق." };
  }

  if (
    user.must_change_password &&
    (!user.temp_password_expires_at || new Date(user.temp_password_expires_at) <= new Date())
  ) {
    await recordAttempt(phone, ipHash, "login", false);
    return {
      kind: "error",
      message: "كلمة السر المؤقتة انتهت صلاحيتها. كلّم صاحب التطبيق يعملها تاني.",
    };
  }

  await recordAttempt(phone, ipHash, "login", true);
  await syncUserLock(user.id, { failures: 0, attemptsLeft: 0, lockedUntil: null });
  await createSession(user.id);
  redirect(user.must_change_password ? "/change-password" : "/");
}

export async function logoutAction(): Promise<void> {
  await destroyCurrentSession();
  redirect("/login");
}

export async function changePasswordAction(input: ChangePasswordInput): Promise<ActionError> {
  const user = await requireUser({ allowPendingPasswordChange: true });

  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) return fromZodError(parsed.error);
  const { currentPassword, newPassword } = parsed.data;

  // After a super-admin reset the user just signed in with the temporary password,
  // so we don't ask for it again. Otherwise the current password is required.
  if (!user.mustChangePassword) {
    if (!currentPassword) return { fieldErrors: { currentPassword: "اكتب كلمة السر الحالية" } };
    const { data, error } = await db()
      .from("users")
      .select("password_hash")
      .eq("id", user.id)
      .single<{ password_hash: string }>();
    if (error) throw new Error(`changePassword lookup failed: ${error.message}`);
    if (!(await verifyPassword(currentPassword, data.password_hash))) {
      return { fieldErrors: { currentPassword: "كلمة السر الحالية غلط" } };
    }
  }

  const { error: updateError } = await db()
    .from("users")
    .update({
      password_hash: await hashPassword(newPassword),
      password_updated_at: new Date().toISOString(),
      must_change_password: false,
      temp_password_expires_at: null,
    })
    .eq("id", user.id);
  if (updateError) throw new Error(`changePassword failed: ${updateError.message}`);

  await revokeOtherSessions(user.id, user.sessionId);

  await db().from("activity_logs").insert({
    actor_user_id: user.id,
    action: "user.password_changed",
    entity_type: "user",
    entity_id: user.id,
    metadata: { after_reset: user.mustChangePassword },
  });

  redirect("/");
}
