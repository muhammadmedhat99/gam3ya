/**
 * Egyptian Arabic counted nouns: 1 اسم، 2 اسمين، 3–10 أسامي، 11+ اسم.
 * forms: [one, two, few (3–10), many (11+)]
 */
export function countLabel(n: number, forms: [string, string, string, string]): string {
  if (n === 1) return forms[0];
  if (n === 2) return forms[1];
  if (n >= 3 && n <= 10) return `${n} ${forms[2]}`;
  return `${n} ${forms[3]}`;
}

export const slotsLabel = (n: number) => countLabel(n, ["اسم واحد", "اسمين", "أسامي", "اسم"]);
export const groupsLabel = (n: number) => countLabel(n, ["جمعية واحدة", "جمعيتين", "جمعيات", "جمعية"]);
export const monthsLabel = (n: number) => countLabel(n, ["شهر واحد", "شهرين", "شهور", "شهر"]);
export const cyclesLabel = (n: number) => countLabel(n, ["دورة واحدة", "دورتين", "دورات", "دورة"]);
export const requestsLabel = (n: number) => countLabel(n, ["طلب واحد", "طلبين", "طلبات", "طلب"]);

export const frequencyLabel = (f: "monthly" | "semi_monthly") => (f === "monthly" ? "شهري" : "كل 15 يوم");
