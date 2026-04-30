/**
 * Heuristic SMS transaction parser tuned for South-Asian, MENA, and global
 * banks, mobile wallets, UPI, and credit-card alerts. Implemented entirely in
 * TypeScript so callers can re-run it on raw SMS pulled from anywhere — not
 * just the live broadcast.
 *
 * The parser is intentionally **strict**: a message is treated as a
 * transaction only when it satisfies BOTH of these:
 *
 *   1. A past-tense, money-moved keyword (`debited`, `credited`, `deducted`,
 *      `withdrawn`, `transferred to/from`, `received from/in`, `refunded`,
 *      `deposited`, `added to your`, `credit alert`, `debit alert`, …).
 *   2. A currency-tagged numeric amount (`Rs. 500`, `PKR 1,250`, `₹500`,
 *      `$12.34`, `1500 PKR`, `Rs.500/-`, …).
 *
 * Either condition alone is not enough — bills, balance reminders, low-credit
 * alerts, recharge nags, and promotional offers all routinely match one or
 * the other in isolation. Requiring both eliminates the entire "any SMS with
 * a digit gets flagged" failure mode.
 *
 * Public functions exported from this module:
 *   - parseTransactionSms(raw)        — strict transaction parse
 *   - isLikelyTransactionSms(body)    — fast strict gate (same rule)
 *   - isLikelyOtpSms(body)            — true for 2FA / OTP codes (excludes transaction confirmations)
 *   - isLikelyPromotionalSms(body)    — true for promo / marketing messages
 *   - extractOtp(raw)                 — pull the OTP digits out, when present
 *   - classifySms(raw)                — coarse SmsCategory classifier
 *   - normaliseBankCode(addr)         — DLT short code → canonical bank id
 *   - runParsers(raw, custom)         — custom parsers ↦ built-in fallback
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

/**
 * **Past-tense, transaction-only debit verbs.** These are the only words
 * that, on their own, justify treating an SMS as a money-out event. Single
 * words like "debit" or "spent" are *not* in this list because they appear
 * in promo copy ("Apply for our debit card", "Spend smarter with us").
 */
const STRONG_DEBIT_KEYWORDS = [
  'debited',
  'deducted',
  'withdrawn',
  'has been charged',
  'was charged',
  'charged as',
  'charged for',
  'charged from',
  'charged on',
  'fee charged',
  'amount charged',
  'amount debited',
  'debit alert',
  'spent at',
  'spent on',
  'paid to',
  'payment to',
  'payment of',
  'transferred to',
  'sent to',
  'purchase at',
  'purchase of',
  'bill paid',
  'tx of',
  'txn of',
  'trxn of',
];

/**
 * **Past-tense, transaction-only credit verbs.** Same rule — only words
 * that always indicate money moved IN. Plain "credit" / "received" are
 * excluded because they collide with marketing copy ("Get instant credit",
 * "We have received your application").
 */
const STRONG_CREDIT_KEYWORDS = [
  'credited',
  'has been credited',
  'was credited',
  'amount credited',
  'credit alert',
  'deposited',
  'received from',
  'received in',
  'received an amount',
  'has received',
  'have received rs',
  'have received pkr',
  'have received inr',
  'transferred from',
  'refunded',
  'reversed to',
  'added to your',
  'cashback received',
  'cashback of rs',
  'cashback of pkr',
  'salary credited',
  'remittance received',
];

/** Strong keywords combined — used by the gate. */
const STRONG_KEYWORDS = [...STRONG_DEBIT_KEYWORDS, ...STRONG_CREDIT_KEYWORDS];

/**
 * Words/phrases that flag a one-time-password / authentication code. Kept
 * narrow on purpose: generic security boilerplate ("do not share", "never
 * disclose") is intentionally excluded because banks include those warnings
 * in regular transaction confirmations too.
 */
const OTP_KEYWORDS = [
  'otp',
  'one-time password',
  'one time password',
  'one time pin',
  'one-time pin',
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
  'two factor',
];

/**
 * Words/phrases that indicate the SMS is purely promotional / marketing.
 * Used as a *negative* signal — a message hitting any of these AND lacking
 * a strong transaction keyword is rejected outright.
 */
const PROMOTIONAL_INDICATORS = [
  'offer',
  'sale',
  'mega sale',
  'discount',
  'voucher',
  'coupon',
  'cashback offer',
  'flat ',
  'flash deal',
  'limited time',
  'hurry',
  't&c apply',
  'tc apply',
  'click here',
  'visit www',
  'visit our website',
  'visit https',
  'visit http',
  'download our app',
  'download the app',
  'congratulations',
  'congrats',
  'you have won',
  'you won',
  'lucky draw',
  'lottery',
  'prize',
  'apply now',
  'avail now',
  'redeem now',
  'register now',
  'subscribe now',
  '% off',
  '% cashback',
  'win rs',
  'win pkr',
  'win inr',
  'win up to',
  'free gift',
  'gift card',
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
  { channel: 'WALLET', pattern: /\b(wallet|jazzcash|easypaisa|sadapay|nayapay|bkash|nagad|paytm wallet|mobikwik|freecharge|konnect|upaisa)\b/i },
  { channel: 'CHEQUE', pattern: /\b(cheque|check\s*no\.?|chq)\b/i },
  { channel: 'BANK_TRANSFER', pattern: /\b(bank transfer|fund transfer|funds transfer|ift|iban|swift|raast|ibft)\b/i },
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
  { code: 'BOP', currency: 'PKR', tokens: ['bop', 'bank of punjab', 'digibop'] },
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
 * Currency-tagged amount detector — used by the strict gate. Matches a
 * number that is *immediately* preceded or followed by a currency token,
 * e.g. `Rs. 1,500`, `PKR 25,000`, `₹500`, `$12.34`, `1,500 PKR`,
 * `Rs.500/-`, `Rs.1500/=`.
 *
 * Bare numbers (no currency word) deliberately do *not* match — that's the
 * whole point of the gate.
 */
const CURRENCY_TAGGED_AMOUNT_REGEX =
  /(?:rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|dhs|sar|qar|omr|kwd|lkr|npr|mvr|₹|৳|\$|€|£)\s?[0-9][0-9,\s]*(?:\.[0-9]{1,2})?(?:\s?\/[\-=])?|[0-9][0-9,\s]*(?:\.[0-9]{1,2})?(?:\s?\/[\-=])?\s?(?:rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|dhs|sar|qar|omr|kwd|lkr|npr|mvr)\b/i;

/**
 * Captures an amount with optional currency prefix/suffix. Handles:
 *   - "Rs. 1,500.00", "PKR 25,000", "INR1500", "₹500", "$ 12.34"
 *   - "1500.50 PKR", "1,500 INR"
 *   - "Rs. 1,500/-" (Pakistani convention with trailing dash)
 *   - "Rs.1500/=" (alternative trailing form)
 * Group 1 = leading currency token, group 2 = number, group 3 = trailing currency token.
 */
const AMOUNT_REGEX =
  /(?:(rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|dhs|sar|qar|omr|kwd|lkr|npr|mvr|₹|৳|\$|€|£)\s?)?([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)(?:\s?\/[\-=])?(?:\s?(rs\.?|pkr|inr|bdt|usd|eur|gbp|aed|dhs|sar|qar|omr|kwd|lkr|npr|mvr))?/gi;

/** Account / card mask — "A/C XX1234", "card ending 1234", "acct *1234", "XXXX-1234". */
const ACCOUNT_REGEX =
  /(?:a\/c|acct|account|card(?:\s+ending)?|card\s+xx|debit\s+card|credit\s+card)[^a-z0-9]{0,4}([x*•·]{0,4}\s?-?\s?\d{3,6}(?:[-\s]?\d{3,6})?)/i;

/** Transaction reference id. Tries common labels first, then a generic alphanumeric token. */
const REFERENCE_REGEX =
  /(?:txn(?:\s+id)?|tx(?:\s+id)?|trx(?:\s+id)?|ref(?:erence)?(?:\s+(?:no|id|#))?|rrn|utr|upi\s+ref|order\s+id|trace(?:\s+id)?|tid)\s*[:#\-.]?\s*([a-z0-9]{5,30})/i;

/** Available balance after the txn. */
const BALANCE_REGEX =
  /(?:avail(?:able)?\s+bal(?:ance)?|avl\s+bal|avbl\s+bal|new\s+balance|bal(?:ance)?)\s*(?:is|:|\-)?\s*(?:rs\.?|pkr|inr|bdt|usd|aed|sar|₹|৳|\$)?\s*([0-9]{1,3}(?:[,\s][0-9]{3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i;

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

/** True iff the body contains at least one strong, past-tense transaction verb. */
function hasStrongTransactionSignal(body: string): boolean {
  const lower = body.toLowerCase();
  return STRONG_KEYWORDS.some((k) => lower.includes(k));
}

/** True iff the body contains a number that is *directly* attached to a currency token. */
function hasCurrencyTaggedAmount(body: string): boolean {
  return CURRENCY_TAGGED_AMOUNT_REGEX.test(body);
}

/**
 * Determine direction (CREDIT / DEBIT) from the strong-keyword sets.
 * Falls back to UNKNOWN only when there's an exact tie between credit and
 * debit signals — extremely rare for real bank SMS.
 */
function detectStrongDirection(body: string): TransactionType {
  const lower = body.toLowerCase();
  let creditScore = 0;
  let debitScore = 0;

  for (const kw of STRONG_CREDIT_KEYWORDS) if (lower.includes(kw)) creditScore += 1;
  for (const kw of STRONG_DEBIT_KEYWORDS) if (lower.includes(kw)) debitScore += 1;

  // Header-style hints carry extra weight.
  if (/\bcredit\s+alert\b/i.test(body)) creditScore += 2;
  if (/\bdebit\s+alert\b/i.test(body)) debitScore += 2;
  if (/\brefund\s+of\b/i.test(body)) creditScore += 2;

  if (creditScore === 0 && debitScore === 0) return 'UNKNOWN';
  if (creditScore === debitScore) return 'UNKNOWN';
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
 * number that is preceded or followed by a known currency token; the first
 * such currency-tagged amount wins. Standalone numbers are deliberately
 * ignored — the strict gate already required currency tagging upstream, so
 * non-tagged numbers in the body are noise (account masks, ref ids, dates).
 */
function detectAmount(body: string): { amount: number | null; currencyToken: string | null } {
  const matches = Array.from(body.matchAll(AMOUNT_REGEX));

  for (const m of matches) {
    const token = (m[1] || m[3] || '').toLowerCase().trim();
    const amount = normaliseAmount(m[2]);
    if (amount === null) continue;
    // Skip absurdly long numbers — almost certainly an account or phone.
    if (m[2].replace(/[^0-9]/g, '').length > 12) continue;
    if (token) return { amount, currencyToken: token };
  }

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

// ---------------------------------------------------------------------------
// Classifiers (exported)
// ---------------------------------------------------------------------------

/**
 * Strict gate — true iff the body has BOTH a strong past-tense transaction
 * verb AND a currency-tagged numeric amount. This is the single source of
 * truth used by the parser; "any SMS with digits" no longer passes.
 */
export function isLikelyTransactionSms(body: string): boolean {
  if (!body || body.length < 10) return false;
  if (!hasStrongTransactionSignal(body)) return false;
  if (!hasCurrencyTaggedAmount(body)) return false;
  return true;
}

/**
 * Returns `true` if the SMS body is a one-time-password / 2FA code rather
 * than a transaction confirmation.
 *
 * The check is deliberately *narrow*: a message is OTP only when it both
 * (a) contains an OTP-specific label like "OTP", "verification code", "2FA",
 * and (b) does NOT contain a strong past-tense transaction verb. Bank
 * transaction SMS routinely include OTP-security boilerplate ("do not
 * share OTP") — those are transactions, not OTPs.
 */
export function isLikelyOtpSms(body: string): boolean {
  const lower = body.toLowerCase();
  if (!OTP_KEYWORDS.some((kw) => lower.includes(kw))) return false;
  // Must contain a short numeric run (OTPs are 4–8 digits).
  if (!/\b\d{4,8}\b/.test(body)) return false;
  // If the body also has a strong transaction verb, treat it as a
  // transaction confirmation that mentions OTP, not as an OTP itself.
  if (hasStrongTransactionSignal(body)) return false;
  return true;
}

/**
 * Returns `true` when the body looks like a marketing / promotional SMS
 * (offers, lucky draws, recharge nags, application reminders) AND lacks
 * any strong transaction signal.
 *
 * "Get Rs. 100 cashback when you spend!" → `true` (promo, no past-tense verb)
 * "Rs. 100 credited as cashback. Use code SAVE10 next time." → `false` (real txn)
 */
export function isLikelyPromotionalSms(body: string): boolean {
  const lower = body.toLowerCase();
  if (!PROMOTIONAL_INDICATORS.some((kw) => lower.includes(kw))) return false;
  if (hasStrongTransactionSignal(body)) return false;
  return true;
}

/**
 * Extract the OTP from a message body, when one is present. Returns `null`
 * when the SMS does not look like an OTP (including transaction
 * confirmations that happen to include OTP-warning boilerplate).
 */
export function extractOtp(raw: RawSmsMessage): ParsedOtp | null {
  if (!isLikelyOtpSms(raw.body)) return null;

  const m = OTP_REGEX.exec(raw.body);
  if (!m) {
    // Fall back to the first 4–8 digit run when the keyword matched but the
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
 * Coarse classification of an SMS. The order matters:
 *
 *   1. OTP wins first (excluding transaction confirmations).
 *   2. Strict transaction gate.
 *   3. Promotional gate.
 *   4. Everything else → OTHER.
 */
export function classifySms(raw: RawSmsMessage): SmsCategory {
  if (isLikelyOtpSms(raw.body)) return 'OTP';
  if (isLikelyTransactionSms(raw.body)) return 'TRANSACTION';
  if (isLikelyPromotionalSms(raw.body)) return 'PROMOTIONAL';
  return 'OTHER';
}

// ---------------------------------------------------------------------------
// Public parser
// ---------------------------------------------------------------------------

/**
 * Run the built-in heuristic parser on a single SMS.
 *
 * Returns `null` unless the body satisfies the strict gate (strong
 * past-tense verb + currency-tagged amount). Promotional and OTP messages
 * are also rejected. Callers that want every SMS — including non-financial
 * ones — should subscribe via `addSmsListener` and inspect `event.category`
 * directly instead of calling this function.
 */
export function parseTransactionSms(raw: RawSmsMessage): ParsedTransaction | null {
  const { body, address } = raw;
  if (!body || body.length < 10) return null;

  // 1. OTPs short-circuit.
  if (isLikelyOtpSms(body)) return null;

  // 2. Pure promotional content short-circuits.
  if (isLikelyPromotionalSms(body)) return null;

  // 3. Strict gate: must have BOTH a strong directional verb AND a
  //    currency-tagged amount. This is the single rule that prevents
  //    "any SMS with digits" from leaking through.
  if (!hasStrongTransactionSignal(body)) return null;

  const { amount, currencyToken } = detectAmount(body);
  if (amount === null || currencyToken === null) return null;

  // From here on we know the message is a transaction; extract the rest.
  const type = detectStrongDirection(body);
  const currency =
    detectCurrency(body, address) ??
    (CURRENCY_MAP[currencyToken] ?? currencyToken.toUpperCase());
  const account = detectAccount(body);
  const reference = detectReference(body);
  const balance = detectBalance(body);
  const merchant = detectMerchant(body);
  const channel = detectChannel(body);
  const status = detectStatus(body);
  const bankCode = normaliseBankCode(address);

  // Confidence model. Base 0.5 because the strict gate is already passed.
  // Bonus signals refine the score upward.
  let confidence = 0.5;
  if (type !== 'UNKNOWN') confidence += 0.15;
  if (currency) confidence += 0.1;
  if (bankCode) confidence += 0.1;
  if (account) confidence += 0.08;
  if (reference) confidence += 0.07;
  if (balance !== null) confidence += 0.05;
  if (channel !== 'UNKNOWN') confidence += 0.05;

  // Failed / pending transactions still parse, but at lower confidence.
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
