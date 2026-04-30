/**
 * Public type definitions for `expo-transaction-sms-reader`.
 *
 * Android-only. iOS / web callers receive `UnsupportedPlatformError` from every
 * runtime method and an empty event stream.
 */

/** Direction of a parsed transaction. */
export type TransactionType = 'CREDIT' | 'DEBIT' | 'UNKNOWN';

/** Status of the user-granted SMS permissions. */
export type SmsPermissionStatus = 'granted' | 'denied' | 'undetermined' | 'blocked';

/**
 * High-level SMS classification — useful for routing messages downstream
 * (bookkeeping vs. OTP vault vs. promotional inbox vs. ignore).
 */
export type SmsCategory =
  | 'TRANSACTION'
  | 'OTP'
  | 'PROMOTIONAL'
  | 'OTHER';

/**
 * Channel through which the transaction was made. Inferred from keywords in
 * the SMS body — useful for analytics (e.g. "% spend via UPI").
 */
export type TransactionChannel =
  | 'UPI'
  | 'IMPS'
  | 'NEFT'
  | 'RTGS'
  | 'CARD'
  | 'ATM'
  | 'POS'
  | 'WALLET'
  | 'BANK_TRANSFER'
  | 'CHEQUE'
  | 'ONLINE'
  | 'UNKNOWN';

/**
 * Final state of the transaction as reported by the issuing bank.
 *
 * `SUCCESS` covers the typical "credited / debited" alert; `PENDING` flags
 * authorisations or pre-auths that have not yet settled; `FAILED` covers
 * declines, reversals, and refunds-of-failed-charges.
 */
export type TransactionStatus = 'SUCCESS' | 'PENDING' | 'FAILED' | 'UNKNOWN';

/**
 * A raw SMS as captured from the system inbox or the live broadcast receiver.
 * The `body` is preserved verbatim; parsing happens separately so callers can
 * apply their own logic if they prefer.
 */
export interface RawSmsMessage {
  /** Internal id from the SMS content provider (`null` for live broadcasts that have not yet been persisted). */
  id: string | null;
  /** Originating address — typically a bank short code or phone number. */
  address: string;
  /** Full SMS body, multipart messages are pre-concatenated. */
  body: string;
  /** Unix epoch milliseconds (UTC) when the device received the message. */
  timestamp: number;
  /** Subscription / SIM slot index, when reported by the OS. `null` on single-SIM devices or older Android. */
  subscriptionId: number | null;
}

/**
 * A heuristically-parsed transaction. Every field except `raw`, `timestamp`,
 * and `confidence` is best-effort — always check `confidence` before acting on
 * the values.
 */
export interface ParsedTransaction {
  /** CREDIT, DEBIT, or UNKNOWN if the parser could not determine direction. */
  type: TransactionType;
  /** Numeric amount, e.g. `1500.00`. `null` when no amount could be located. */
  amount: number | null;
  /** ISO-4217 currency code (PKR, INR, USD, …) or the literal symbol if no code matched. `null` when unresolved. */
  currency: string | null;
  /** Best guess at the bank, wallet or short code that sent the SMS. */
  sender: string;
  /**
   * Normalised bank/wallet identifier (e.g. `HBL`, `HDFC`, `JAZZCASH`) when the
   * sender id matches a known institution. `null` when unrecognised — useful as
   * a stable analytics key, since DLT short codes vary by carrier (`HDFCBK`,
   * `VK-HDFCBK`, `HDFC-S`, …).
   */
  bankCode: string | null;
  /** Account / card mask, e.g. "****1234", when present. */
  account: string | null;
  /** Available balance after the transaction, when present. */
  balance: number | null;
  /** Transaction or reference id (TID, RRN, UPI ref, etc.), when present. */
  reference: string | null;
  /** Free-form merchant / counterparty extracted from the body, when present. */
  merchant: string | null;
  /** Inferred payment rail / channel. `UNKNOWN` when no signal was found. */
  channel: TransactionChannel;
  /** Settlement status of the transaction, when explicitly stated by the bank. Defaults to `SUCCESS`. */
  status: TransactionStatus;
  /** Unix epoch ms — same as the raw SMS timestamp. */
  timestamp: number;
  /** Heuristic confidence score in [0, 1]. Below 0.4 the parser is essentially guessing. */
  confidence: number;
  /** The original SMS, untouched, for fallback parsing or audit logging. */
  raw: RawSmsMessage;
}

/**
 * One-time-password / authentication code extracted from an SMS. Returned by
 * {@link extractOtp} so callers can prefill verification screens.
 */
export interface ParsedOtp {
  /** The OTP digits, with surrounding whitespace and punctuation stripped. */
  code: string;
  /** Validity window in seconds, when the SMS body declares one (e.g. "valid for 5 minutes"). */
  validForSeconds: number | null;
  /** Best guess at the issuing service / sender. */
  sender: string;
}

/**
 * Optional, user-supplied parser. Receives the raw SMS and returns a parsed
 * transaction — or `null` to fall through to the next parser, ultimately
 * landing on the built-in heuristic parser.
 *
 * Custom parsers run *before* the built-in parser so callers can override
 * specific banks (e.g. a known short code with a quirky format).
 */
export type CustomParser = (raw: RawSmsMessage) => ParsedTransaction | null;

/** Event payload fired for every incoming SMS, regardless of whether parsing succeeded. */
export interface SmsReceivedEvent {
  /** The raw SMS as delivered by Android. */
  raw: RawSmsMessage;
  /** The parsed transaction, or `null` if no parser produced a result. */
  transaction: ParsedTransaction | null;
  /** Coarse classification of the SMS — useful for routing decisions. */
  category: SmsCategory;
}

/** Options for {@link addSmsListener} / {@link startListening}. */
export interface StartListeningOptions {
  /**
   * Only emit events whose parsed `confidence` is at least this value.
   * Use `0` (default) to emit every SMS — including non-transaction ones, with `transaction: null`.
   */
  minConfidence?: number;
  /**
   * Emit events for SMS whose body matches one of these patterns *in addition to*
   * the built-in transaction heuristics. Useful for catching merchant-specific formats.
   */
  extraKeywords?: string[];
  /**
   * If `true`, swallow duplicate SMS (same address + body within 5 seconds). Defaults to `true`.
   */
  deduplicate?: boolean;
  /**
   * If `true`, suppress events that the parser flags as OTPs (one-time passwords).
   * Defaults to `false`. OTPs are still surfaced through the parser — they just
   * don't reach the listener when this flag is on.
   */
  ignoreOtp?: boolean;
  /**
   * Restrict events to SMS from these sender addresses (case-insensitive). Both
   * exact short codes (`HDFCBK`) and DLT prefixes (`VK-HDFCBK`) are matched.
   * Empty / undefined = no filter.
   */
  senderAllowlist?: string[];
}

/** Options for {@link getRecentMessages}. */
export interface GetRecentMessagesOptions {
  /** Max rows to return. Defaults to 50, capped at 500 to avoid OOM on huge inboxes. */
  limit?: number;
  /** Only return SMS newer than this Unix epoch ms timestamp. */
  sinceTimestamp?: number;
  /** Only return SMS whose body matches the built-in transaction heuristics. Defaults to `false`. */
  onlyTransactions?: boolean;
  /**
   * Restrict the query to SMS from these sender addresses (case-insensitive).
   * Empty / undefined = no filter.
   */
  senderAllowlist?: string[];
  /**
   * Minimum parser confidence required to include a row. Defaults to `0`
   * (include everything). Rows whose parser returned `null` are excluded when
   * this is `> 0`.
   */
  minConfidence?: number;
}

/** Options for {@link summarizeTransactions}. */
export interface SummarizeOptions {
  /**
   * Minimum confidence to include a transaction in the totals. Defaults to
   * `0.4` — anything below is rounding error from a guessing parser.
   */
  minConfidence?: number;
  /**
   * If set, only roll up transactions whose currency matches this code. Mixing
   * currencies into a single total is almost never what callers want, so the
   * default behaviour is to bucket per-currency in {@link TransactionSummary.byCurrency}.
   */
  currency?: string;
}

/** Aggregate totals returned by {@link summarizeTransactions}. */
export interface TransactionSummary {
  /** Total credited across all included transactions, summed per currency. */
  credit: number;
  /** Total debited across all included transactions, summed per currency. */
  debit: number;
  /** `credit - debit`. */
  net: number;
  /** Number of transactions included in the totals. */
  count: number;
  /** Per-currency breakdown — useful when the inbox mixes currencies. */
  byCurrency: Record<string, { credit: number; debit: number; net: number; count: number }>;
  /** Per-channel breakdown (UPI, CARD, …) summed across all currencies. */
  byChannel: Record<TransactionChannel, { credit: number; debit: number; count: number }>;
  /** Per-bank breakdown keyed by `bankCode` (or `sender` when no `bankCode`). */
  bySender: Record<string, { credit: number; debit: number; count: number }>;
}

/** Strongly-typed map of events emitted by the native module. */
export type ExpoTransactionSmsReaderEvents = {
  onSmsReceived: (event: SmsReceivedEvent) => void;
  onError: (event: { code: string; message: string }) => void;
};

/**
 * Error thrown when an Android-only API is called on iOS or web. Callers can
 * `instanceof`-check this to surface a friendly UI message.
 */
export class UnsupportedPlatformError extends Error {
  constructor(method: string, platform: string) {
    super(
      `expo-transaction-sms-reader.${method}() is only available on Android. ` +
        `Current platform: ${platform}.`
    );
    this.name = 'UnsupportedPlatformError';
  }
}

/**
 * Error thrown when the user has not granted READ_SMS / RECEIVE_SMS. Callers
 * can catch this to direct the user to system settings.
 */
export class SmsPermissionError extends Error {
  constructor(message?: string) {
    super(message ?? 'READ_SMS / RECEIVE_SMS not granted.');
    this.name = 'SmsPermissionError';
  }
}
