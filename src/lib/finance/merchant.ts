// ---------------------------------------------------------------------------
// Personal Finance — merchant normalization.
//
// Bank descriptors are not names: the same payee arrives as "SQ *BLUE BOTTLE",
// "TESCO STORES 3614" and "AMAZON.CO.UK*MK1AB2CD3". Matching a bill to a charge
// and spotting a duplicate both depend on two descriptors for the same payee
// reducing to the same string, and on two different payees NOT reducing to the
// same string.
//
// The one rule that matters more than the cleverness: never reduce a descriptor
// to the empty string. An empty normalized name substring-matches every bill,
// which would silently mark unrelated charges as paying a bill.
// ---------------------------------------------------------------------------

/** Prefixes that card networks and processors staple onto a descriptor. */
const PREFIXES = [
  "sq *",
  "sq*",
  "tst* ",
  "tst*",
  "paypal *",
  "paypal*",
  "pos debit ",
  "pos ",
  "card purchase ",
  "visa purchase ",
  "debit card purchase ",
];

export function normalizeMerchant(raw: string): string {
  let s = raw.toLowerCase().trim();

  for (const p of PREFIXES) {
    if (s.startsWith(p)) {
      s = s.slice(p.length);
      break;
    }
  }

  // Everything after a "*" on a processor descriptor is a reference, not a name.
  const star = s.indexOf("*");
  if (star > 0) s = s.slice(0, star);

  // Punctuation to spaces, then collapse.
  s = s.replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();

  // A trailing run of digits is a store or reference number.
  const stripped = s.replace(/\s+\d+$/, "").trim();
  // ...unless stripping leaves nothing, which happens for all-numeric
  // descriptors. An empty name matches every bill, so keep the original.
  return stripped.length > 0 ? stripped : s;
}

/** Does a normalized merchant contain any of these matchers? */
export function matchesAny(merchantNorm: string, matchers: string[]): boolean {
  return matchers.some((m) => {
    const needle = normalizeMerchant(m);
    // An empty matcher would match everything. Treat it as no matcher at all.
    return needle.length > 0 && merchantNorm.includes(needle);
  });
}
