import products from "@/data/products.json";

// "Show more options": the rest of the catalog's FDA hearing aids, instantly, no model call.
// The plan payback reuses the OTC allowance Kin already derived from the plan documents (?allowance=).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const exclude = new Set((url.searchParams.get("exclude") ?? "").split(",").filter(Boolean));
  const allowance = Math.max(0, Number(url.searchParams.get("allowance")) || 0);
  const isHearingAid = (c: string) => c === "otc_hearing_aid" || c === "prescription_hearing_aid";

  const options = products
    .filter((p) => !exclude.has(p.sku) && isHearingAid(p.fda_category))
    .map((p) => {
      const otc = p.fda_category === "otc_hearing_aid";
      const planPays = otc ? Math.min(allowance, p.price_pair_usd) : 0;
      const downsides = [
        p.behind_the_ear && "Sits behind the ear, so it may bump your glasses.",
        !p.rechargeable && "Uses tiny disposable batteries.",
        !otc && "Needs an in-person test and fitting; your plan's OTC allowance doesn't apply.",
      ].filter(Boolean) as string[];
      return {
        sku: p.sku,
        name: p.name,
        style: p.style,
        rechargeable: p.rechargeable,
        behind_the_ear: p.behind_the_ear,
        self_fitting_app: p.self_fitting_app,
        fda_category: p.fda_category,
        retailer: p.retailer,
        product_url: p.url,
        price_pair_usd: p.price_pair_usd,
        return_window_days: p.return_window_days,
        label: "More option",
        reason: `${p.style[0].toUpperCase()}${p.style.slice(1)}, ${p.rechargeable ? "rechargeable" : "battery powered"}, from ${p.retailer}.`,
        tradeoff: downsides[0] ?? "",
        route: planPays > 0 ? "otc_allowance" : "out_of_pocket",
        family_pays_usd: Math.round((p.price_pair_usd - planPays) * 100) / 100,
        plan_pays_usd: planPays,
      };
    })
    .sort((a, b) => a.family_pays_usd - b.family_pays_usd);

  const hidden = products.filter((p) => !exclude.has(p.sku) && !isHearingAid(p.fda_category)).length;
  return Response.json({ options, hidden_not_fda: hidden });
}
