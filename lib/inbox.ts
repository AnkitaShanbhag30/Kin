import inbox from "@/data/inbox.json";

// Demo inbox standing in for Gmail (real Gmail needs Google's restricted-scope review).
export type Email = (typeof inbox)[number];

const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysUntil = (iso: string) => Math.ceil((new Date(iso + "T12:00:00").getTime() - Date.now()) / 86_400_000);

export function searchEmail(query: string) {
  const terms = query.toLowerCase().split(/\W+/).filter((t) => t.length > 2);
  return inbox
    .map((e) => {
      const hay = `${e.from} ${e.subject} ${e.body} ${e.labels.join(" ")}`.toLowerCase();
      return { e, score: terms.filter((t) => hay.includes(t)).length };
    })
    .filter((x) => x.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ e }) => ({ id: e.id, from: e.from, subject: e.subject, date: e.date, labels: e.labels, body: e.body }));
}

// Deterministic scan run when Gmail is connected: deliveries with return deadlines, plus medical mail.
export function scanInbox() {
  const deliveries = inbox
    .filter((e) => e.labels.includes("delivered") && e.return_window_days)
    .map((e) => {
      const returnBy = addDays(e.date, e.return_window_days!);
      return {
        email_id: e.id,
        item: e.item!,
        retailer: e.retailer!,
        order_ref: e.order_ref!,
        delivered_on: e.date,
        return_by: returnBy,
        days_left: daysUntil(returnBy),
      };
    });
  const medical = inbox
    .filter((e) => e.labels.includes("medical"))
    .map((e) => ({ email_id: e.id, from: e.from, subject: e.subject, date: e.date, body: e.body }));
  return { deliveries, medical, scanned: inbox.length };
}
