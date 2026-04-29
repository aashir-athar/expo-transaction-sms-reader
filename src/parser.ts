/**
 * Heuristic SMS transaction parser tuned for South-Asian banks, mobile wallets,
 * UPI, and credit-card alerts. Implemented entirely in TypeScript so callers
 * can re-run it on raw SMS pulled from anywhere — not just the live broadcast.
 *
 * The parser is intentionally conservative: it returns `null` (or low
 * confidence) when it cannot identify enough signal, rather than guessing.
 */

import type {
  CustomParser,
  ParsedTransaction,
  RawSmsMessage,
  TransactionType,
} from './ExpoTransactionSmsReader.types';

// ---------------------------------------------------------------------------
// Vocabulary
// ---------------------------------------------------------------------------

const DEBIT_KEYWORDS = [
  'debited',
  'debit',
  'spent',
  'paid',
  'purchase',
  'withdrawn',
  'withdrawal',
  'sent',
  'transferred to',
  'tx of',
  'txn of',
  'charged',
  'deducted',
];

const CREDIT_KEYWORDS = [
  'credited',
  'credit',
  'received',
  'deposited',
  'refund',
  'cashback',
  'added to',
  'transferred from',
  'salary',
];

/**
 * Heuristic list of strings that strongly suggest the SMS is a financial
 * transaction. Used as the primary filter for `onlyTransactions: true`.
 */
const TRANSACTION_INDICATORS = [
  ...DEBIT_KEYWORDS,
  ...CREDIT_KEYWORDS,
  'a/c',
  'acct',
  'account',
  'available bal',
  'avail bal',
  'avbl bal',
  'bal:',
  'balance',
  'upi',
  'imps',
  'neft',
  'rtgs',
  'pos',
  'atm',
  'card ending',
  'card xx',
  'wallet',
  'jazzcash',
  'easypaisa',
  'sadapay',
  'nayapay',
];

const CURRENCY_MAP: Record<string, string> = {
  'rs.': 'PKR',
  'rs': 'PKR',
  'rupees': 'PKR',
  'pkr': 'PKR',
  'inr': 'INR',
  '₹': 'INR',
  'rs ': 'INR', // fallback — disambiguated by sender below
  'bdt': 'BDT',
  '৳': 'BDT',
  'taka': 'BDT',
  'usd': 'USD',
  '$': 'USD',
  'eur': 'EUR',
  '€': 'EUR',
  'gbp': 'GBP',
  '£': 'GBP',
  'aed': 'AED',
  'sar': 'SAR',
};

/**
 * Country hint from the sender id. Used to disambiguate "Rs" between PKR & INR.
 * If the sender contains any of these tokens we lock the currency.
 */
const SENDER_COUNTRY_HINTS: Array<{ tokens: string[]; currency: string }> = [
  { tokens: ['hbl', 'ubl', 'mcb', 'meezan', 'allied', 'askari', 'faysal', 'bafl', 'jazz', 'easypaisa', 'sadapay', 'nayapay', 'jazzcash'], currency: 'PKR' },
  { tokens: ['hdfc', 'icici', 'sbi', 'axis', 'kotak', 'paytm', 'phonepe', 'gpay', 'bhim', 'yes bank', 'yesbank', 'idfc', 'rbl'], currency: 'INR' },
  { tokens: ['bkash', 'nagad', 'rocket', 'dbbl', 'brac'], currency: 'BDT' },
];

// ---------------------------------------------------------------------------
// Regex toolbox
// ---------------------------------------------------------------------------

/**
 * Captures an amount with optional currency prefix/suffix. Handles:
 *   - "Rs. 1,500.00", "PKR 25,000", "INR1500", "₹500", "$ 12.34"
 *   - "1500.50 PKR", "1,500 INR"
 * Group 1 = currency token, group 2 = number.
 */
const AMOUNT_REGEX =
  /(?:(rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|sar|₹|৳|\$|€|£)\s?)?([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?:\s?(rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|sar))?/gi;

/** Account / card mask — "A/C XX1234", "card ending 1234", "acct *1234". */
const ACCOUNT_REGEX =
  /(?:a\/c|acct|account|card(?:\s+ending)?|card\s+xx|debit\s+card|credit\s+card)[^a-z0-9]{0,4}([x*•·]{0,4}\s?\d{3,6})/i;

/** Transaction reference id. Tries common labels first, then a generic alphanumeric token. */
const REFERENCE_REGEX =
  /(?:txn(?:\s+id)?|tx(?:\s+id)?|trx(?:\s+id)?|ref(?:erence)?(?:\s+(?:no|id|#))?|rrn|utr|upi\s+ref|order\s+id|trace(?:\s+id)?)\s*[:#\-.]?\s*([a-z0-9]{5,30})/i;

/** Available balance after the txn. */
const BALANCE_REGEX =
  /(?:avail(?:able)?\s+bal(?:ance)?|avl\s+bal|avbl\s+bal|bal(?:ance)?)\s*(?:is|:|\-)?\s*(?:rs\.?|pkr|inr|bdt|usd|₹|৳|\$)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;

/** Merchant after "at" / "to" / "from" up to a delimiter. */
const MERCHANT_REGEX =
  /\b(?:at|to|from|towards?|in favour of)\s+([A-Z0-9][A-Z0-9 &@._\-/]{2,40}?)(?=[.,;:\n]|\s+(?:on|dated|at|for|via|using|ref|rrn|utr|txn|tx|avail|bal)|$)/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normaliseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function detectType(body: string): TransactionType {
  const lower = body.toLowerCase();
  let creditScore = 0;
  let debitScore = 0;

  for (const kw of CREDIT_KEYWORDS) if (lower.includes(kw)) creditScore += 1;
  for (const kw of DEBIT_KEYWORDS) if (lower.includes(kw)) debitScore += 1;

  // Strong signals — explicit "credit alert" / "debit alert" headers.
  if (/\bcredit\s+alert\b/i.test(body)) creditScore += 2;
  if (/\bdebit\s+alert\b/i.test(body)) debitScore += 2;

  if (creditScore === 0 && debitScore === 0) return 'UNKNOWN';
  return creditScore > debitScore ? 'CREDIT' : 'DEBIT';
}

function detectCurrency(body: string, sender: string): string | null {
  const senderLower = sender.toLowerCase();
  for (const hint of SENDER_COUNTRY_HINTS) {
    if (hint.tokens.some((t) => senderLower.includes(t))) return hint.currency;
  }

  const bodyLower = body.toLowerCase();
  for (const [token, code] of Object.entries(CURRENCY_MAP)) {
    if (bodyLower.includes(token)) return code;
  }
  return null;
}

/**
 * Pick the most plausible amount from the body. Strategy: collect every
 * number that is preceded or followed by a known currency token; if none
 * exist, fall back to the largest standalone number that has at least 3
 * digits (filters out "card ending 1234" style noise).
 */
function detectAmount(body: string): { amount: number | null; currencyToken: string | null } {
  const matches = Array.from(body.matchAll(AMOUNT_REGEX));
  let bestWithCurrency: { amount: number; token: string } | null = null;
  let bestStandalone: number | null = null;

  for (const m of matches) {
    const token = (m[1] || m[3] || '').toLowerCase().trim();
    const amount = normaliseAmount(m[2]);
    if (amount === null) continue;
    if (token) {
      // Prefer the first currency-tagged amount — it's almost always the txn amount.
      if (!bestWithCurrency) bestWithCurrency = { amount, token };
    } else if (amount >= 100 && (bestStandalone === null || amount > bestStandalone)) {
      bestStandalone = amount;
    }
  }

  if (bestWithCurrency) return { amount: bestWithCurrency.amount, currencyToken: bestWithCurrency.token };
  if (bestStandalone !== null) return { amount: bestStandalone, currencyToken: null };
  return { amount: null, currencyToken: null };
}

function detectAccount(body: string): string | null {
  const m = ACCOUNT_REGEX.exec(body);
  if (!m) return null;
  return m[1].replace(/\s+/g, '').replace(/[•·]/g, '*');
}

function detectReference(body: string): string | null {
  const m = REFERENCE_REGEX.exec(body);
  return m ? m[1].toUpperCase() : null;
}

function detectBalance(body: string): number | null {
  const m = BALANCE_REGEX.exec(body);
  return m ? normaliseAmount(m[1]) : null;
}

function detectMerchant(body: string): string | null {
  const m = MERCHANT_REGEX.exec(body);
  if (!m) return null;
  const raw = m[1].trim().replace(/\s{2,}/g, ' ');
  // Reject obvious false positives ("at 12:34", "to A/C…").
  if (/^\d/.test(raw) || /^(a\/c|acct|account)\b/i.test(raw)) return null;
  return raw;
}

/**
 * Quick check: does the message even look like a transaction? Used as the
 * primary gate in `getRecentMessages({ onlyTransactions: true })`.
 */
export function isLikelyTransactionSms(body: string): boolean {
  const lower = body.toLowerCase();
  return TRANSACTION_INDICATORS.some((kw) => lower.includes(kw));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the built-in heuristic parser on a single SMS.
 *
 * Returns `null` only when the message clearly is not a transaction (no
 * indicator keywords AND no detectable amount). Otherwise always returns a
 * `ParsedTransaction` — inspect `confidence` to gauge reliability.
 */
export function parseTransactionSms(raw: RawSmsMessage): ParsedTransaction | null {
  const { body, address } = raw;
  if (!body || body.length < 10) return null;

  const looksLikeTxn = isLikelyTransactionSms(body);
  const { amount, currencyToken } = detectAmount(body);

  if (!looksLikeTxn && amount === null) return null;

  const type = detectType(body);
  const currency = detectCurrency(body, address) ??
    (currencyToken ? CURRENCY_MAP[currencyToken] ?? currencyToken.toUpperCase() : null);
  const account = detectAccount(body);
  const reference = detectReference(body);
  const balance = detectBalance(body);
  const merchant = detectMerchant(body);

  // Confidence model: 0.0 baseline, +0.25 for indicator keywords, +0.25 for an
  // amount, +0.15 for a known type, +0.1 each for currency/account/reference,
  // capped at 0.95.
  let confidence = 0;
  if (looksLikeTxn) confidence += 0.25;
  if (amount !== null) confidence += 0.25;
  if (type !== 'UNKNOWN') confidence += 0.15;
  if (currency) confidence += 0.1;
  if (account) confidence += 0.1;
  if (reference) confidence += 0.1;
  if (balance !== null) confidence += 0.05;
  confidence = Math.min(0.95, Number(confidence.toFixed(2)));

  return {
    type,
    amount,
    currency,
    sender: address,
    account,
    balance,
    reference,
    merchant,
    timestamp: raw.timestamp,
    confidence,
    raw,
  };
}

/**
 * Run an array of custom parsers, falling back to {@link parseTransactionSms}.
 * The first parser to return a non-null value wins.
 */
export function runParsers(
  raw: RawSmsMessage,
  custom: CustomParser[] = []
): ParsedTransaction | null {
  for (const fn of custom) {
    try {
      const result = fn(raw);
      if (result) return result;
    } catch {
      // Custom parsers must never crash the listener — skip on error.
    }
  }
  return parseTransactionSms(raw);
}
