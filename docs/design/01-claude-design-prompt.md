# Prompt 1 — Design system + core screens

Copy everything below the line into Claude Design.

---

Design a mobile-first Arabic (RTL) Progressive Web App called **جمعيتي**
for managing Egyptian rotating savings associations (جمعيات).

## What the product is

A record-keeping app for people who run a جمعية. The organizer (admin)
creates an association, adds people by name and phone, splits each
"name" (slot / اسم) into shares, sets the payout order manually, and
privately tracks who paid. Members can open the app to see the
association, the members, and the payout order, but **never** whether
anyone paid. The app does not move money. It only records what the
admin says happened.

Key domain idea the design must make obvious: **a slot (اسم) is not a
person.** One اسم worth 1,000 ج.م can be split between two people, e.g.
إبراهيم 750 + أسامة 250. One person can also own shares in several
names. When a name's turn comes, each owner receives their own share.

## Users

- **Admin (صاحب الجمعية / أدمن):** usually 30–55, organizes جمعية for
  family, neighbors, or coworkers. Comfortable with WhatsApp, not with
  complex apps. Needs speed and certainty about money.
- **Member (عضو):** opens the app occasionally to check their turn.

## Visual direction

- Trustworthy, calm, and warm. It should feel like a careful
  notebook kept by someone you trust, not a cold bank app and not a
  flashy fintech app.
- One primary brand color plus neutrals. Propose a palette and
  explain it. Semantic colors are used **only in admin financial
  views**: paid (مدفوع), partially paid (دفع جزء), unpaid (لسه
  مدفعش), overdue (متأخر).
- Arabic typography first: use **IBM Plex Sans Arabic** (or propose a
  better free Arabic font), with clear sizes for amounts.
- Large touch targets (min 44px), high contrast (WCAG AA), generous
  spacing, rounded corners, soft elevation.
- Light mode for this round. Define tokens so dark mode can be added
  later.

## Hard constraints

- Full RTL layout. Icons that imply direction (back arrows, chevrons)
  must be mirrored.
- Baseline frame: 390 × 844 (iPhone 14). Desktop is not needed now.
- Egyptian Arabic UI copy, short and friendly (e.g. "سجّل دخول",
  "ضيف عضو", "دور مين الشهر ده؟").
- Amounts in Western digits with thousands separators and the
  currency after the number: `1,000 ج.م`. Phone numbers in Western
  digits: `010 1234 5678`.
- Bottom navigation with 4 tabs: الرئيسية، جمعياتي، الإشعارات، حسابي.
- The implementation will use **HeroUI v3 + Tailwind CSS**, so design
  with standard components: buttons, inputs, cards, chips, tabs, bottom
  sheets/drawers, modals, lists, progress bars, skeletons, toasts.
- **Privacy rule:** any screen a member sees must contain no payment
  status, amounts paid, remaining balances, or overdue markers, for
  anyone (including the member themself).
- Every data screen needs: loading (skeleton), empty, and error
  states.

## Sample data (use consistently)

- Association: **جمعية العيلة**, slot value **1,000 ج.م**, **10
  أسامي**, monthly, starts 1 يناير 2027, collection due on day 5.
- Members: محمد، أحمد، حسن، إبراهيم، أسامة، منى، سارة، كريم، ياسمين،
  عمرو، هبة.
- Slot 3 is split: إبراهيم 750 + أسامة 250. Slot 6 is split: أحمد 500
  + حسن 500. Others are owned by one person. أحمد also fully owns
  slot 9.
- Current cycle: الدورة 3 of 10, due 5 مارس 2027. Payout this cycle
  goes to slot 3 (إبراهيم 750 + أسامة 250).

## Deliverables

1. **Design system sheet:** color tokens, type scale, spacing, radius,
   elevation, and core components with their states (default, pressed,
   disabled, loading, error), including the status chips and the
   amount display.
2. **The screens below**, each at 390 × 844, with loading/empty/error
   variants where listed.

## Screens

### A. Authentication
1. **Login (تسجيل الدخول):** phone + password, "انسى كلمة السر؟"
   link that opens a sheet explaining to contact the app owner (there
   is no self-service reset), link to register. Error state: "رقم
   الموبايل أو كلمة السر غلط". Locked state after many attempts.
2. **Register (حساب جديد):** full name, phone, password, confirm
   password, password rules hint (8+ characters). Error: phone already
   has an account.
3. **Forced password change:** shown after the app owner reset the
   password. The user can't go anywhere else until they set a new
   one. Calm, reassuring tone.

### B. Home (الرئيسية)
4. **Home, regular user:** greeting, a card per association showing
   name, next payout turn (whose اسم and the date), and the user's own
   share(s). No payment info.
5. **Home, pending approval:** user registered with a phone an admin
   had already added. Show a neutral notice like "في جمعيات مستنية
   موافقة الأدمن عشان تظهرلك". Do **not** show the association's name
   or details.
6. **Home, admin:** same as 4, plus an "محتاج تعمله" section with
   counts: pending link requests, members overdue in the current cycle
   (admin-only), next payout to record.
7. **Home, empty:** no associations yet, with a "اعمل جمعية" call to
   action.

### C. Associations
8. **جمعياتي list:** cards with role badge (أدمن / عضو), status
   (مسودة، شغالة، خلصت), progress (الدورة 3 من 10). Empty and loading
   states.
9. **Create association wizard (3 steps with a progress indicator):**
   (1) name, slot value, number of names; (2) frequency (شهري / كل 15
   يوم), start date, due day; (3) review, with the computed total per
   cycle (`slot value × number of names` = 10,000 ج.م).

### D. Association overview: two versions of the same screen
10. **Member view:** header (name, value, frequency, current cycle),
    tabs: نظرة عامة، الأعضاء، الأدوار. Shows the payout order list with
    "دورك" highlighted on the member's own slots. No payment info
    anywhere.
11. **Admin view:** same header, plus admin tabs: التحصيل، الأسامي،
    الأعضاء، الأدوار، الإعدادات. Overview shows current-cycle collection
    progress (e.g. 7,250 من 10,000 ج.م), overdue count, and this cycle's
    payout split.

### E. Admin setup
12. **Members (الأعضاء):** list with each member's state: مسجل في
    التطبيق، مش مسجل، مستني موافقة. "ضيف عضو" bottom sheet (name +
    phone). If the phone already has an account, the sheet shows the
    registered name and asks the admin to confirm linking.
13. **Link requests (طلبات الربط):** each request compares the name
    the person registered with to the name the admin entered, plus the
    phone, with approve and reject actions and a confirmation step.
14. **Names & shares (الأسامي):** one card per slot (اسم 1 … اسم 10)
    with a horizontal split bar showing each owner's share (e.g. 750 /
    250). Status: كامل (sum = 1,000), ناقص (less), زيادة (more), with
    the difference shown.
15. **Edit shares sheet for one slot:** add an owner (pick an existing
    member), enter an amount, live "الباقي: 250 ج.م" indicator, save
    disabled until the total equals exactly 1,000.
16. **Payout order (ترتيب القبض):** reorderable list of slots (drag
    handle **and** up/down buttons for accessibility), each row showing
    order number, slot, owners, and expected date. Sticky "احفظ
    الترتيب" button with an unsaved-changes state.

### F. Admin collections (admin only)
17. **Current cycle collection (التحصيل):** summary (collected /
    expected, overdue count), filter chips (الكل، متأخر، دفع جزء، لسه،
    مدفوع), list per member: due, paid, remaining, status chip. أحمد
    owes 1,500 (500 from slot 6 + 1,000 from slot 9).
18. **Record payment sheet:** member, amount due, already paid,
    remaining; amount input (defaults to remaining, partial allowed),
    date, optional note. After a partial payment, the status shows
    "دفع جزء" with the remaining amount, **never** "مدفوع".
19. **Member payment history (admin):** list of payments and any
    reversals (shown as reversal entries, not deletions), with a
    "تصحيح" action that creates a reversal.

Not in this round (will follow in a later prompt): payouts recording,
notifications, profile & sessions, super-admin panel, reports.
