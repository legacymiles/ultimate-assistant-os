// ---------------------------------------------------------------------------
// Symbol specifications.
//
// Each symbol defines the per-lot contract size and what "1 point" means in
// price terms. This is the math layer; UI just reads from it. All values are
// independent of broker — they describe the *instrument*, not the account.
// ---------------------------------------------------------------------------

export interface Symbol {
  code: string;
  name: string;
  /** Quote currency (account-side P/L is denominated here for XAUUSD on a USD account). */
  quoteCurrency: string;
  /** Units of base instrument per 1.0 lot. XAUUSD on MT4 = 100 troy ounces. */
  contractSize: number;
  /** Smallest price increment ("point"). XAUUSD MT4 = 0.01. */
  pointSize: number;
  /** Points per pip. XAUUSD = 10 (1 pip = 0.10). */
  pointsPerPip: number;
  /** Display precision for prices. */
  pricePrecision: number;
}

export const SYMBOLS: Record<string, Symbol> = {
  XAUUSD: {
    code: "XAUUSD",
    name: "Gold (XAUUSD)",
    quoteCurrency: "USD",
    contractSize: 100,
    pointSize: 0.01,
    pointsPerPip: 10,
    pricePrecision: 2,
  },
};

export const DEFAULT_SYMBOL = "XAUUSD";

export function getSymbol(code: string): Symbol {
  return SYMBOLS[code] ?? SYMBOLS[DEFAULT_SYMBOL];
}
