import { appIconResponse } from "@/lib/app-icon";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Browser tab icon. */
export default function Icon() {
  return appIconResponse(64, { rounded: true });
}
