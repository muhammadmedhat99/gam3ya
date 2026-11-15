import { notFound } from "next/navigation";
import { appIconResponse } from "@/lib/app-icon";

/** PWA icons listed in manifest.ts: /icons/192.png, /icons/512.png, /icons/maskable-512.png */
const ICONS: Record<string, { size: number; maskable?: boolean }> = {
  "192.png": { size: 192 },
  "512.png": { size: 512 },
  "maskable-512.png": { size: 512, maskable: true },
};

export const dynamic = "force-static";

export function generateStaticParams() {
  return Object.keys(ICONS).map((file) => ({ file }));
}

export async function GET(_req: Request, ctx: RouteContext<"/icons/[file]">) {
  const { file } = await ctx.params;
  const icon = ICONS[file];
  if (!icon) notFound();
  return appIconResponse(icon.size, { maskable: icon.maskable });
}
