/**
 * Public type definitions for `expo-transaction-sms-reader`.
 *
 * Android-only. iOS callers receive `UnsupportedPlatformError` from every
 * runtime method and an empty event stream.
 */

/** Direction of a parsed transaction. */
export type TransactionType = 'CREDIT' | 'DEBIT' | 'UNKNOWN';

/** Status of the user-granted SMS permissions. */
export type SmsPermissionStatus = 'granted' | 'denied' | 'undetermined';

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
 * A heuristically-parsed transaction. Every field except `raw` and `confidence`
 * is best-effort — always check `confidence` before acting on the values.
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
  /** Account / card mask, e.g. "****1234", when present. */
  account: string | null;
  /** Available balance after the transaction, when present. */
  balance: number | null;
  /** Transaction or reference id (TID, RRN, UPI ref, etc.), when present. */
  reference: string | null;
  /** Free-form merchant / counterparty extracted from the body, when present. */
  merchant: string | null;
  /** Unix epoch ms — same as the raw SMS timestamp. */
  timestamp: number;
  /** Heuristic confidence score in [0, 1]. Below 0.4 the parser is essentially guessing. */
  confidence: number;
  /** The original SMS, untouched, for fallback parsing or audit logging. */
  raw: RawSmsMessage;
}

/**
 * Optional, user-supplied parser. Receives the raw SMS and returns a parsed
 * transaction — or `null` to fall through to the default parser.
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
}

/** Options for {@link startListening}. */
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
}

/** Options for {@link getRecentMessages}. */
export interface GetRecentMessagesOptions {
  /** Max rows to return. Defaults to 50, capped at 500 to avoid OOM on huge inboxes. */
  limit?: number;
  /** Only return SMS newer than this Unix epoch ms timestamp. */
  sinceTimestamp?: number;
  /** Only return SMS whose body matches the built-in transaction heuristics. Defaults to `false`. */
  onlyTransactions?: boolean;
}

/** Strongly-typed map of events emitted by the native module. */
export type ExpoTransactionSmsReaderEvents = {
  onSmsReceived: (event: SmsReceivedEvent) => void;
  onError: (event: { code: string; message: string }) => void;
};
