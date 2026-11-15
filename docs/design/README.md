# Design

- **Canvas:** https://claude.ai/artifact/7UtcS2HLZDazSbdKRMex3y
  ("جمعيتي — نظام التصميم والشاشات", private to the owner).
- **Prompt used to generate it:** [01-claude-design-prompt.md](01-claude-design-prompt.md)

## Pages on the canvas → code

| Canvas page | Artboards | Code |
| --- | --- | --- |
| نظام التصميم | Main (colors), DS-Type, DS-Tokens, DS-Components-1/2 | `src/app/globals.css`, `src/components/ui/` |
| الدخول والتسجيل | Login (+Error, Locked, Forgot), Register (+Error), Force-Password | `src/app/(auth)/`, `src/features/auth/` ✅ |
| الرئيسية | Home-Member, Home-Admin, Home-Pending, Home-Empty, Home-Loading, Home-Error | `src/app/(app)/(tabs)/page.tsx` ✅ |
| جمعياتي | Assoc-List (+Empty, Loading), Create-1/2/3 | `src/app/(app)/(tabs)/groups/`, `src/app/(app)/groups/new/` ✅ |
| صفحة الجمعية | Overview-Member, Overview-Admin | `src/app/(app)/(tabs)/groups/[groupId]/` ✅ (collection card waits for payments) |
| إعداد الجمعية | Members (+Add, Add-Existing, Empty), Link-Requests (+Confirm, Empty), Names, Names-Edit, Payout-Order | `…/members`, `…/requests`, `…/names`, `…/order`, `src/features/{members,requests,slots,order}/` ✅ (reorder uses arrows, no drag yet) |
| التحصيل | Collection (+Record, Loading, Filter-Empty), Payment-History, Payment-Reversal | `…/collection`, `…/collection/[memberId]`, `src/features/collections/` ✅ |
