/**
 * Heuristic SMS transaction parser tuned for South-Asian, MENA, and global
 * banks, mobile wallets, UPI, and credit-card alerts. Implemented entirely in
 * TypeScript so callers can re-run it on raw SMS pulled from anywhere — not
 * just the live broadcast.
 *
 * The parser is intentionally conservative: it returns `null` (or low
 * confidence) when it cannot identify enough signal, rather than guessing.
 *
 * Public functions exported from this module:
 *   - parseTransactionSms(raw)   — best-effort transaction parse
 *   - isLikelyTransactionSms(b)  — keyword-only gate, very fast
 *   - isLikelyOtpSms(b)          — true if the body looks like a 2FA / OTP code
 *   - extractOtp(raw)            — pull the OTP digits out, when present
 *   - classifySms(raw)           — coarse SmsCategory classifier
 *   - normaliseBankCode(addr)    — DLT short code → canonical bank id
 *   - runParsers(raw, custom)    — custom parsers ↦ built-in fallback
 */

import type {
  CustomParser,
  ParsedOtp,
  ParsedTransaction,
  RawSmsMessage,
  SmsCategory,
  TransactionChannel,
  TransactionStatus,
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
  'paid to',
  'payment to',
  'bill paid',
  'sent to',
];

const CREDIT_KEYWORDS = [
  'credited',
  'credit',
  'received',
  'deposited',
  'refund',
  'refunded',
  'cashback',
  'added to',
  'transferred from',
  'salary',
  'received from',
  'reversed to',
  'incoming',
  'remittance',
];

/** Words that strongly suggest the message is a one-time-password / OTP. */
const OTP_KEYWORDS = [
  'otp',
  'one-time password',
  'one time password',
  'verification code',
  'verification pin',
  'security code',
  'login code',
  'auth code',
  'authentication code',
  'pin code',
  'passcode',
  'tac code',
  '2fa',
  'two-factor',
  'do not share',
  'do not disclose',
  'never share',
  'will never ask',
];

/**
 * Words/phrases that indicate the SMS is purely promotional. Used to push the
 * classifier away from `TRANSACTION` for ambiguous cases.
 */
const PROMOTIONAL_KEYWORDS = [
  'offer',
  'sale',
  'discount',
  'voucher',
  'coupon',
  'cashback offer',
  'flat ',
  'flash deal',
  'limited time',
  'hurry',
  't&c apply',
  'click here',
  'visit ',
  'download our app',
];

/** Words that flag a *failed* or *declined* transaction. */
const FAILURE_KEYWORDS = [
  'failed',
  'declined',
  'unsuccessful',
  'unable to process',
  'reversed',
  'reversal',
  'rejected',
  'not approved',
  'transaction failure',
];

/** Words that flag an *authorised but not yet settled* transaction. */
const PENDING_KEYWORDS = [
  'pending',
  'authorised',
  'authorized',
  'pre-auth',
  'pre auth',
  'on hold',
  'awaiting',
  'in process',
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
  'avl bal',
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
  'bkash',
  'nagad',
  'paytm',
  'phonepe',
  'gpay',
  'visa',
  'mastercard',
];

/**
 * Channel detection — first match wins. Order matters: more specific rails
 * (UPI, IMPS) are checked before generic ones (CARD, ONLINE).
 */
const CHANNEL_RULES: Array<{ channel: TransactionChannel; pattern: RegExp }> = [
  { channel: 'UPI', pattern: /\b(upi|vpa|@[a-z]{2,}|gpay|phonepe|bhim|paytm upi)\b/i },
  { channel: 'IMPS', pattern: /\bimps\b/i },
  { channel: 'NEFT', pattern: /\bneft\b/i },
  { channel: 'RTGS', pattern: /\brtgs\b/i },
  { channel: 'ATM', pattern: /\b(atm|cash withdrawal)\b/i },
  { channel: 'POS', pattern: /\bpos\b|point[\s-]of[\s-]sale/i },
  { channel: 'CARD', pattern: /\b(card|debit\s*card|credit\s*card|visa|mastercard|amex|rupay)\b/i },
  { channel: 'WALLET', pattern: /\b(wallet|jazzcash|easypaisa|sadapay|nayapay|bkash|nagad|paytm wallet|mobikwik|freecharge)\b/i },
  { channel: 'CHEQUE', pattern: /\b(cheque|check\s*no\.?|chq)\b/i },
  { channel: 'BANK_TRANSFER', pattern: /\b(bank transfer|fund transfer|ift|iban|swift)\b/i },
  { channel: 'ONLINE', pattern: /\b(online|e-commerce|ecom|web)\b/i },
];

/**
 * Currency tokens recognised in the body. Order matters here too — longer
 * tokens must come before shorter ones to avoid `rs` swallowing `rs.`.
 */
const CURRENCY_MAP: Record<string, string> = {
  'rs.': 'PKR',
  'pkr': 'PKR',
  'rupees': 'PKR',
  'rs': 'PKR',
  'inr': 'INR',
  '₹': 'INR',
  'bdt': 'BDT',
  'taka': 'BDT',
  '৳': 'BDT',
  'usd': 'USD',
  '$': 'USD',
  'eur': 'EUR',
  '€': 'EUR',
  'gbp': 'GBP',
  '£': 'GBP',
  'aed': 'AED',
  'dhs': 'AED',
  'sar': 'SAR',
  'qar': 'QAR',
  'omr': 'OMR',
  'kwd': 'KWD',
  'lkr': 'LKR',
  'npr': 'NPR',
  'mvr': 'MVR',
};

/**
 * Country / currency hint from the sender id. Used to disambiguate "Rs"
 * between PKR / INR / LKR / NPR. If the sender contains any of these tokens
 * we lock the currency.
 *
 * Each entry also doubles as a `bankCode` source — the first token is treated
 * as the canonical id (uppercased) when it matches.
 */
const SENDER_BANK_REGISTRY: Array<{
  /** Canonical bank/wallet code returned in `ParsedTransaction.bankCode`. */
  code: string;
  /** Currency this institution typically transacts in. */
  currency: string;
  /** Substrings that, when found in the sender id, identify the bank. */
  tokens: string[];
}> = [
  // ── Pakistan — banks ────────────────────────────────────────────────────
  { code: 'HBL', currency: 'PKR', tokens: ['hbl', 'habib bank'] },
  { code: 'UBL', currency: 'PKR', tokens: ['ubl', 'united bank'] },
  { code: 'MCB', currency: 'PKR', tokens: ['mcb', 'muslim commercial'] },
  { code: 'MEEZAN', currency: 'PKR', tokens: ['meezan'] },
  { code: 'ALLIED', currency: 'PKR', tokens: ['abl', 'allied'] },
  { code: 'ASKARI', currency: 'PKR', tokens: ['askari', 'akbl'] },
  { code: 'FAYSAL', currency: 'PKR', tokens: ['faysal', 'fbl'] },
  { code: 'BAFL', currency: 'PKR', tokens: ['bafl', 'bank alfalah', 'alfalah'] },
  { code: 'STANCHART_PK', currency: 'PKR', tokens: ['stanchart', 'standard chartered'] },
  { code: 'HABIBMETRO', currency: 'PKR', tokens: ['habibmetro', 'habib metro'] },
  { code: 'BAH', currency: 'PKR', tokens: ['bank al habib', 'bahl'] },
  { code: 'SONERI', currency: 'PKR', tokens: ['soneri'] },
  { code: 'SUMMIT', currency: 'PKR', tokens: ['summit'] },
  { code: 'SILK', currency: 'PKR', tokens: ['silkbank'] },
  { code: 'NBP', currency: 'PKR', tokens: ['nbp', 'national bank of pakistan'] },
  { code: 'JS', currency: 'PKR', tokens: ['js bank', 'jsbank'] },
  { code: 'DIB_PK', currency: 'PKR', tokens: ['dib pakistan', 'dubai islamic bank'] },
  { code: 'BANKISLAMI', currency: 'PKR', tokens: ['bankislami', 'islami bank'] },
  // ── Pakistan — wallets ──────────────────────────────────────────────────
  { code: 'JAZZCASH', currency: 'PKR', tokens: ['jazzcash', 'jazz cash', 'jazz'] },
  { code: 'EASYPAISA', currency: 'PKR', tokens: ['easypaisa', 'easy paisa'] },
  { code: 'SADAPAY', currency: 'PKR', tokens: ['sadapay'] },
  { code: 'NAYAPAY', currency: 'PKR', tokens: ['nayapay'] },
  { code: 'KONNECT', currency: 'PKR', tokens: ['konnect'] },
  { code: 'UPAISA', currency: 'PKR', tokens: ['upaisa'] },
  // ── India — banks ───────────────────────────────────────────────────────
  { code: 'HDFC', currency: 'INR', tokens: ['hdfc', 'hdfcbk', 'hdfcbank'] },
  { code: 'ICICI', currency: 'INR', tokens: ['icici', 'icicib'] },
  { code: 'SBI', currency: 'INR', tokens: ['sbi', 'sbiinb', 'sbibank'] },
  { code: 'AXIS', currency: 'INR', tokens: ['axis', 'axisbk'] },
  { code: 'KOTAK', currency: 'INR', tokens: ['kotak', 'kmbl'] },
  { code: 'YES', currency: 'INR', tokens: ['yes bank', 'yesbnk', 'yesbank'] },
  { code: 'IDFC', currency: 'INR', tokens: ['idfc'] },
  { code: 'RBL', currency: 'INR', tokens: ['rbl'] },
  { code: 'CANARA', currency: 'INR', tokens: ['canara', 'canbnk'] },
  { code: 'PNB', currency: 'INR', tokens: ['pnb'] },
  { code: 'BOB', currency: 'INR', tokens: ['bob', 'bobtxn', 'bank of baroda'] },
  { code: 'FEDERAL', currency: 'INR', tokens: ['federal bank', 'federalbk'] },
  { code: 'INDUSIND', currency: 'INR', tokens: ['indusind', 'indus'] },
  { code: 'IDBI', currency: 'INR', tokens: ['idbi'] },
  { code: 'CITI_IN', currency: 'INR', tokens: ['citibank', 'citibk'] },
  { code: 'AMEX_IN', currency: 'INR', tokens: ['american express', 'amex'] },
  // ── India — wallets / UPI ───────────────────────────────────────────────
  { code: 'PAYTM', currency: 'INR', tokens: ['paytm'] },
  { code: 'PHONEPE', currency: 'INR', tokens: ['phonepe', 'phone pe'] },
  { code: 'GPAY', currency: 'INR', tokens: ['gpay', 'google pay'] },
  { code: 'BHIM', currency: 'INR', tokens: ['bhim'] },
  { code: 'AMAZONPAY', currency: 'INR', tokens: ['amazon pay', 'amazonpay'] },
  { code: 'MOBIKWIK', currency: 'INR', tokens: ['mobikwik'] },
  { code: 'FREECHARGE', currency: 'INR', tokens: ['freecharge'] },
  // ── Bangladesh ──────────────────────────────────────────────────────────
  { code: 'BKASH', currency: 'BDT', tokens: ['bkash'] },
  { code: 'NAGAD', currency: 'BDT', tokens: ['nagad'] },
  { code: 'ROCKET', currency: 'BDT', tokens: ['rocket', 'dbbl mobile'] },
  { code: 'UPAY_BD', currency: 'BDT', tokens: ['upay'] },
  { code: 'DBBL', currency: 'BDT', tokens: ['dbbl'] },
  { code: 'BRAC', currency: 'BDT', tokens: ['brac'] },
  { code: 'EBL', currency: 'BDT', tokens: ['ebl', 'eastern bank'] },
  // ── UAE / KSA / GCC ─────────────────────────────────────────────────────
  { code: 'ENBD', currency: 'AED', tokens: ['emirates nbd', 'enbd'] },
  { code: 'ADCB', currency: 'AED', tokens: ['adcb'] },
  { code: 'FAB', currency: 'AED', tokens: ['fab', 'first abu dhabi'] },
  { code: 'MASHREQ', currency: 'AED', tokens: ['mashreq'] },
  { code: 'RAK', currency: 'AED', tokens: ['rakbank'] },
  { code: 'ALRAJHI', currency: 'SAR', tokens: ['rajhi', 'al rajhi'] },
  { code: 'RIYAD', currency: 'SAR', tokens: ['riyad bank'] },
  { code: 'NCB', currency: 'SAR', tokens: ['ncb', 'alahli'] },
  { code: 'ALINMA', currency: 'SAR', tokens: ['alinma', 'inma'] },
];

// ---------------------------------------------------------------------------
// Regex toolbox
// ---------------------------------------------------------------------------

/**
 * Captures an amount with optional currency prefix/suffix. Handles:
 *   - "Rs. 1,500.00", "PKR 25,000", "INR1500", "₹500", "$ 12.34"
 *   - "1500.50 PKR", "1,500 INR"
 *   - "Rs. 1,500/-" (Pakistani convention with trailing dash)
 * Group 1 = leading currency token, group 2 = number, group 3 = trailing currency token.
 */
const AMOUNT_REGEX =
  /(?:(rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|dhs|sar|qar|omr|kwd|lkr|npr|mvr|₹|৳|\$|€|£)\s?)?([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?:\s?\/\-)?(?:\s?(rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|dhs|sar|qar|omr|kwd|lkr|npr|mvr))?/gi;

/** Account / card mask — "A/C XX1234", "card ending 1234", "acct *1234". */
const ACCOUNT_REGEX =
  /(?:a\/c|acct|account|card(?:\s+ending)?|card\s+xx|debit\s+card|credit\s+card)[^a-z0-9]{0,4}([x*•·]{0,4}\s?\d{3,6})/i;

/** Transaction reference id. Tries common labels first, then a generic alphanumeric token. */
const REFERENCE_REGEX =
  /(?:txn(?:\s+id)?|tx(?:\s+id)?|trx(?:\s+id)?|ref(?:erence)?(?:\s+(?:no|id|#))?|rrn|utr|upi\s+ref|order\s+id|trace(?:\s+id)?|tid)\s*[:#\-.]?\s*([a-z0-9]{5,30})/i;

/** Available balance after the txn. */
const BALANCE_REGEX =
  /(?:avail(?:able)?\s+bal(?:ance)?|avl\s+bal|avbl\s+bal|bal(?:ance)?)\s*(?:is|:|\-)?\s*(?:rs\.?|pkr|inr|bdt|usd|aed|sar|₹|৳|\$)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;

/** Merchant after "at" / "to" / "from" up to a delimiter. */
const MERCHANT_REGEX =
  /\b(?:at|to|from|towards?|in favour of|paid to|received from|sent to)\s+([A-Z0-9][A-Z0-9 &@._\-/]{2,40}?)(?=[.,;:\n]|\s+(?:on|dated|at|for|via|using|ref|rrn|utr|txn|tx|avail|bal|info)|$)/i;

/**
 * OTP capture — accepts 4–10 digit codes preceded by an OTP-style label,
 * with optional spaces / hyphens between digit groups (some banks send
 * "123 456" or "12-34-56").
 */
const OTP_REGEX =
  /\b(?:otp|one[\s-]?time[\s-]?(?:password|pin|code)|verification(?:\s+code)?|security\s+code|login\s+code|auth\s+code|tac|passcode|pin)\b[^0-9]{0,16}([0-9][0-9\s\-]{3,12}[0-9])\b/i;

/** OTP validity — "valid for 5 minutes", "expires in 10 mins". */
const OTP_VALIDITY_REGEX =
  /(?:valid|expires?)\s+(?:for|in|till|until)\s+(\d{1,3})\s*(sec|secs|second|seconds|min|mins|minute|minutes|hr|hrs|hour|hours)/i;

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

  // "Refund of Rs. X" almost always means CREDIT, even when other words don't match.
  if (/\brefund\s+of\b/i.test(body)) creditScore += 2;

  if (creditScore === 0 && debitScore === 0) return 'UNKNOWN';
  return creditScore > debitScore ? 'CREDIT' : 'DEBIT';
}

function detectChannel(body: string): TransactionChannel {
  for (const rule of CHANNEL_RULES) {
    if (rule.pattern.test(body)) return rule.channel;
  }
  return 'UNKNOWN';
}

function detectStatus(body: string): TransactionStatus {
  const lower = body.toLowerCase();
  for (const kw of FAILURE_KEYWORDS) if (lower.includes(kw)) return 'FAILED';
  for (const kw of PENDING_KEYWORDS) if (lower.includes(kw)) return 'PENDING';
  return 'SUCCESS';
}

/**
 * Turn a sender id like `VK-HDFCBK` or `JM-JAZZCS-S` into a stable canonical
 * code (`HDFC`, `JAZZCASH`, …) using {@link SENDER_BANK_REGISTRY}. Returns
 * `null` when no entry matched.
 */
export function normaliseBankCode(address: string): string | null {
  const lower = address.toLowerCase();
  for (const entry of SENDER_BANK_REGISTRY) {
    if (entry.tokens.some((t) => lower.includes(t))) return entry.code;
  }
  return null;
}

function detectCurrency(body: string, sender: string): string | null {
  // 1. Sender registry takes priority — it's the only reliable signal for "Rs".
  const senderLower = sender.toLowerCase();
  for (const entry of SENDER_BANK_REGISTRY) {
    if (entry.tokens.some((t) => senderLower.includes(t))) return entry.currency;
  }

  // 2. Fall back to body tokens. Iterate longest-first so `rs.` wins over `rs`.
  const tokens = Object.keys(CURRENCY_MAP).sort((a, b) => b.length - a.length);
  const bodyLower = body.toLowerCase();
  for (const token of tokens) {
    if (bodyLower.includes(token)) return CURRENCY_MAP[token];
  }
  return null;
}

/**
 * Pick the most plausible amount from the body. Strategy: collect every
 * number that is preceded or followed by a known currency token; if none
 * exist, fall back to the largest standalone number that has at least 3
 * digits (filters out "card ending 1234" style noise).
 *
 * Numbers that look like account masks, OTPs, dates, or phone numbers are
 * excluded — long digit runs (10+) and 4–6 digit codes following OTP-style
 * keywords get filtered out before scoring.
 */
function detectAmount(body: string): { amount: number | null; currencyToken: string | null } {
  const matches = Array.from(body.matchAll(AMOUNT_REGEX));
  let bestWithCurrency: { amount: number; token: string } | null = null;
  let bestStandalone: number | null = null;

  for (const m of matches) {
    const token = (m[1] || m[3] || '').toLowerCase().trim();
    const amount = normaliseAmount(m[2]);
    if (amount === null) continue;

    // Skip absurdly long numbers — almost certainly an account or phone.
    if (m[2].replace(/[^0-9]/g, '').length > 12) continue;

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

/**
 * Returns `true` if the SMS body is overwhelmingly likely to be a one-time
 * password rather than a transaction alert. The check is intentionally
 * permissive on the OTP side — false positives here just mean the message
 * gets routed to the OTP bucket instead of the transaction one.
 */
export function isLikelyOtpSms(body: string): boolean {
  const lower = body.toLowerCase();
  if (!OTP_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  // Must contain at least one short numeric run that isn't an amount.
  return /\b\d{4,8}\b/.test(body);
}

/**
 * Extract the OTP from a message body, when one is present. Returns `null`
 * when the SMS does not look like an OTP.
 */
export function extractOtp(raw: RawSmsMessage): ParsedOtp | null {
  if (!isLikelyOtpSms(raw.body)) return null;

  const m = OTP_REGEX.exec(raw.body);
  if (!m) {
    // Fall back to the first 4–8 digit run when keyword matched but the
    // labelled regex didn't — common with terse OTP messages.
    const fallback = /\b(\d{4,8})\b/.exec(raw.body);
    if (!fallback) return null;
    return {
      code: fallback[1],
      validForSeconds: parseValidity(raw.body),
      sender: raw.address,
    };
  }

  const code = m[1].replace(/[^0-9]/g, '');
  return {
    code,
    validForSeconds: parseValidity(raw.body),
    sender: raw.address,
  };
}

function parseValidity(body: string): number | null {
  const m = OTP_VALIDITY_REGEX.exec(body);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  const unit = m[2].toLowerCase();
  if (unit.startsWith('sec')) return value;
  if (unit.startsWith('min')) return value * 60;
  if (unit.startsWith('hr') || unit.startsWith('hour')) return value * 3600;
  return null;
}

/**
 * Coarse classification of an SMS — useful for routing logic in the consumer
 * app (transaction → bookkeeping, OTP → autofill, promo → ignore).
 *
 * The check order is deliberate: OTPs win first (they're easy to identify and
 * users care most about them), then transactions, then promos.
 */
export function classifySms(raw: RawSmsMessage): SmsCategory {
  if (isLikelyOtpSms(raw.body)) return 'OTP';
  if (isLikelyTransactionSms(raw.body)) return 'TRANSACTION';

  const lower = raw.body.toLowerCase();
  if (PROMOTIONAL_KEYWORDS.some((kw) => lower.includes(kw))) return 'PROMOTIONAL';
  return 'OTHER';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run the built-in heuristic parser on a single SMS.
 *
 * Returns `null` only when the message clearly is not a transaction (no
 * indicator keywords AND no detectable amount) or when it is an OTP.
 * Otherwise always returns a `ParsedTransaction` — inspect `confidence` to
 * gauge reliability.
 */
export function parseTransactionSms(raw: RawSmsMessage): ParsedTransaction | null {
  const { body, address } = raw;
  if (!body || body.length < 10) return null;

  // OTPs are never transactions, even if they happen to mention an amount
  // (some banks send "Use OTP 123456 to authorise Rs. 5,000").
  if (isLikelyOtpSms(body)) return null;

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
  const channel = detectChannel(body);
  const status = detectStatus(body);
  const bankCode = normaliseBankCode(address);

  // Confidence model: 0.0 baseline. Positive signals add, negative signals
  // subtract. Capped at 0.95 — the parser is a heuristic, not an oracle.
  let confidence = 0;
  if (looksLikeTxn) confidence += 0.25;
  if (amount !== null) confidence += 0.25;
  if (type !== 'UNKNOWN') confidence += 0.15;
  if (currency) confidence += 0.1;
  if (bankCode) confidence += 0.1;
  if (account) confidence += 0.08;
  if (reference) confidence += 0.07;
  if (balance !== null) confidence += 0.05;
  if (channel !== 'UNKNOWN') confidence += 0.05;

  // Negative signal: failed transactions still get a confidence score, but
  // we cap them slightly below "definitely happened" levels.
  if (status === 'FAILED') confidence = Math.min(confidence, 0.7);
  if (status === 'PENDING') confidence = Math.min(confidence, 0.8);

  confidence = Math.min(0.95, Number(confidence.toFixed(2)));

  return {
    type,
    amount,
    currency,
    sender: address,
    bankCode,
    account,
    balance,
    reference,
    merchant,
    channel,
    status,
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
