"use client";

import { Button, Label, TextArea, TextField } from "@heroui/react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Notice } from "@/components/ui/notice";
import {
  adminRecoverAccountAction,
  adminResetPasswordAction,
  adminSetUserStatusAction,
} from "@/server/actions/admin";

type Sheet = "reset" | "recover" | "block" | "unblock" | null;

function Field({
  label,
  value,
  onChange,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
}) {
  return multiline ? (
    <TextField value={value} onChange={onChange} className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <TextArea rows={2} className="rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 py-3 text-base" />
    </TextField>
  ) : (
    <label className="flex flex-col gap-1.5">
      <span className="text-label text-ink">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-13 rounded-[12px] border-[1.5px] border-line-strong bg-surface px-3.5 text-base text-ink"
      />
    </label>
  );
}

/** Reset password, recover account for the real phone owner, block / unblock. */
export function AdminUserActions({
  userId,
  status,
  isSuperAdmin,
}: {
  userId: string;
  status: "active" | "blocked";
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");

  async function run(fn: () => Promise<{ ok: true } | { error?: string }>, success: string) {
    setPending(true);
    setError(null);
    const result = await fn();
    setPending(false);
    if ("ok" in result) {
      setSheet(null);
      setDone(success);
      setNote("");
      router.refresh();
    } else setError(result.error ?? "حصلت مشكلة.");
  }

  const close = () => !pending && (setSheet(null), setError(null));

  return (
    <div className="flex flex-col gap-2">
      {done && (
        <Notice tone="accent" title="اتعمل">
          {done}
        </Notice>
      )}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onPress={() => setSheet("reset")}>
          Reset كلمة السر
        </Button>
        <Button variant="outline" onPress={() => setSheet("recover")} isDisabled={isSuperAdmin}>
          استرجاع الحساب
        </Button>
        {status === "active" ? (
          <Button variant="danger-soft" className="col-span-2" isDisabled={isSuperAdmin} onPress={() => setSheet("block")}>
            وقّف الحساب
          </Button>
        ) : (
          <Button variant="outline" className="col-span-2" onPress={() => setSheet("unblock")}>
            شغّل الحساب تاني
          </Button>
        )}
      </div>

      {sheet === "reset" && (
        <BottomSheet
          isOpen
          onOpenChange={(o) => !o && close()}
          title="Reset كلمة السر؟"
          footer={
            <Button size="lg" fullWidth isPending={pending} onPress={() => run(() => adminResetPasswordAction({ userId }), "كلمة السر بقت 123456789 لمدة 24 ساعة. ابعتها لصاحب الحساب.")}>
              أيوه، اعمل reset
            </Button>
          }
        >
          {error && <Notice title={error} />}
          <p className="text-body text-body">
            اتأكد الأول إن ده صاحب الحساب. كلمة السر هتبقى <b className="tabular">123456789</b> لمدة 24 ساعة، وهيتطلب منه
            يغيّرها أول ما يدخل، وهيخرج من كل أجهزته.
          </p>
        </BottomSheet>
      )}

      {sheet === "recover" && (
        <BottomSheet
          isOpen
          onOpenChange={(o) => !o && close()}
          title="استرجاع الحساب لصاحب الرقم"
          footer={
            <Button
              size="lg"
              fullWidth
              isPending={pending}
              isDisabled={fullName.trim().length < 2 || note.trim().length < 3}
              onPress={() =>
                run(
                  () => adminRecoverAccountAction({ userId, fullName, email, note }),
                  "الحساب اتسلّم لصاحب الرقم. كلمة السر المؤقتة 123456789 لمدة 24 ساعة.",
                )
              }
            >
              استرجع الحساب
            </Button>
          }
        >
          {error && <Notice title={error} />}
          <Notice tone="warning" title="قبل ما تكمل">
            راجع الجمعيات والأدوار اللي على الحساب ده تحت. العضويات اللي جت بالرقم هتروح لصاحب الرقم، وأي جمعية مش بتاعته
            لازم تتظبط الأول.
          </Notice>
          <Field label="اسم صاحب الرقم" value={fullName} onChange={setFullName} />
          <Field label="الإيميل (اختياري)" value={email} onChange={setEmail} />
          <Field label="اتأكدت منه إزاي؟" value={note} onChange={setNote} multiline />
        </BottomSheet>
      )}

      {(sheet === "block" || sheet === "unblock") && (
        <BottomSheet
          isOpen
          onOpenChange={(o) => !o && close()}
          title={sheet === "block" ? "توقف الحساب؟" : "تشغّل الحساب تاني؟"}
          footer={
            <Button
              size="lg"
              fullWidth
              variant={sheet === "block" ? "danger" : "primary"}
              isPending={pending}
              onPress={() =>
                run(
                  () => adminSetUserStatusAction({ userId, status: sheet === "block" ? "blocked" : "active", note }),
                  sheet === "block" ? "الحساب اتوقف وخرج من كل أجهزته." : "الحساب اشتغل تاني.",
                )
              }
            >
              {sheet === "block" ? "أيوه، وقّفه" : "أيوه، شغّله"}
            </Button>
          }
        >
          {error && <Notice title={error} />}
          <p className="text-body text-body">
            {sheet === "block"
              ? "مش هيقدر يدخل التطبيق لحد ما تشغّله تاني، وهيخرج من كل أجهزته دلوقتي. بياناته في الجمعيات مش هتتمسح."
              : "هيقدر يدخل تاني بكلمة السر بتاعته."}
          </p>
          <Field label="السبب (اختياري)" value={note} onChange={setNote} multiline />
        </BottomSheet>
      )}
    </div>
  );
}
