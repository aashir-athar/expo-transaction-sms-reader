/**
 * `expo-transaction-sms-reader` — public API.
 *
 * Android-only. Wraps the Kotlin native module with:
 *   - permission helpers (with status caching + "blocked" detection)
 *   - typed listener subscriptions (ref-counted — multiple subscribers are safe)
 *   - heuristic transaction parser (extensible via custom parsers)
 *   - OTP detection / extraction
 *   - aggregation utilities (summarise, groupBy, format)
 *   - safe iOS / web stubs
 */

import { Platform, type EventSubscription } from 'expo-modules-core';

import NativeModule from './ExpoTransactionSmsReaderModule';
import {
  classifySms,
  extractOtp,
  isLikelyOtpSms,
  isLikelyPromotionalSms,
  isLikelyTransactionSms,
  normaliseBankCode,
  parseTransactionSms,
  runParsers,
} from './parser';
import {
  SmsPermissionError,
  UnsupportedPlatformError,
  type CustomParser,
  type GetRecentMessagesOptions,
  type ParsedTransaction,
  type RawSmsMessage,
  type SmsCategory,
  type SmsPermissionStatus,
  type SmsReceivedEvent,
  type StartListeningOptions,
  type SummarizeOptions,
  type TransactionChannel,
  type TransactionSummary,
  type TransactionType,
} from './ExpoTransactionSmsReader.types';

export * from './ExpoTransactionSmsReader.types';
export {
  classifySms,
  extractOtp,
  isLikelyOtpSms,
  isLikelyPromotionalSms,
  isLikelyTransactionSms,
  normaliseBankCode,
  parseTransactionSms,
};

// ---------------------------------------------------------------------------
// Internal state — kept module-scoped so `start/stopListening` are idempotent
// and ref-counted across multiple `addSmsListener` callers.
// ---------------------------------------------------------------------------

let nativeSubscription: EventSubscription | null = null;
let errorSubscription: EventSubscription | null = null;
const customParsers: CustomParser[] = [];

interface ActiveListener {
  callback: (event: SmsReceivedEvent) => void;
  options: Required<Pick<StartListeningOptions, 'minConfidence' | 'extraKeywords' | 'deduplicate' | 'ignoreOtp'>> & {
    senderAllowlist: string[];
  };
}
const listeners = new Set<ActiveListener>();

const isAndroid = Platform.OS === 'android';

function ensureAndroid(method: string): void {
  if (!isAndroid) throw new UnsupportedPlatformError(method, Platform.OS);
}

function normaliseSenderList(list: string[] | undefined): string[] {
  if (!list || list.length === 0) return [];
  return list.map((s) => s.toLowerCase().trim()).filter(Boolean);
}

function senderMatches(allowlist: string[], address: string): boolean {
  if (allowlist.length === 0) return true;
  const lower = address.toLowerCase();
  return allowlist.some((token) => lower.includes(token));
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Returns the current status for `READ_SMS` + `RECEIVE_SMS`.
 *
 * Resolves to `'denied'` on iOS / web — the package is Android-only, so there
 * is nothing to grant.
 */
export async function getPermissionStatusAsync(): Promise<SmsPermissionStatus> {
  if (!isAndroid) return 'denied';
  return NativeModule.getPermissionStatusAsync();
}

/**
 * Prompts the user to grant `READ_SMS` and `RECEIVE_SMS`. The prompt is shown
 * once per app session — repeated calls after a "Don't ask again" denial will
 * resolve to `'blocked'` (Android 11+) or `'denied'` (older). Direct the user
 * to system settings in either case.
 *
 * Tip: pair this with {@link openAppSettings} to give users a one-tap path
 * back to the permission screen when they've blocked the prompt.
 */
export async function requestPermissionsAsync(): Promise<SmsPermissionStatus> {
  if (!isAndroid) return 'denied';
  return NativeModule.requestPermissionsAsync();
}

/**
 * Convenience wrapper — resolves the current status, requesting permissions
 * if they are not already granted. Returns the final status.
 */
export async function ensurePermissionsAsync(): Promise<SmsPermissionStatus> {
  const status = await getPermissionStatusAsync();
  if (status === 'granted') return status;
  return requestPermissionsAsync();
}

/**
 * Open the host app's system settings page. Useful when the user has
 * blocked the SMS permission and the only way back is the OS settings UI.
 *
 * No-op on iOS / web.
 */
export async function openAppSettings(): Promise<void> {
  if (!isAndroid) return;
  // The native module surfaces this through a private `Function` invoked
  // by name — older versions of the package don't have it, so we soft-fall.
  const fn = (NativeModule as unknown as { openAppSettings?: () => void }).openAppSettings;
  if (typeof fn === 'function') fn.call(NativeModule);
}

// ---------------------------------------------------------------------------
// Custom parsers
// ---------------------------------------------------------------------------

/**
 * Register a parser that runs *before* the built-in heuristic parser. Useful
 * for bank-specific formats whose body matches the heuristics poorly.
 *
 * @returns an unregister function — call it to remove the parser.
 */
export function registerParser(parser: CustomParser): () => void {
  customParsers.push(parser);
  return () => {
    const idx = customParsers.indexOf(parser);
    if (idx >= 0) customParsers.splice(idx, 1);
  };
}

/** Remove every custom parser. */
export function clearParsers(): void {
  customParsers.length = 0;
}

// ---------------------------------------------------------------------------
// Listener
// ---------------------------------------------------------------------------

function dispatchSmsEvent(rawSms: RawSmsMessage): void {
  const transaction = runParsers(rawSms, customParsers);
  const category: SmsCategory = transaction ? 'TRANSACTION' : classifySms(rawSms);

  for (const listener of listeners) {
    try {
      if (transaction && transaction.confidence < listener.options.minConfidence) continue;
      if (listener.options.ignoreOtp && category === 'OTP') continue;
      if (!senderMatches(listener.options.senderAllowlist, rawSms.address)) continue;

      // Apply per-listener `extraKeywords` filter — if set, the SMS body
      // must match either the global transaction heuristics or one of the
      // listener-supplied keywords.
      if (listener.options.extraKeywords.length > 0 && !transaction) {
        const lower = rawSms.body.toLowerCase();
        const matches = listener.options.extraKeywords.some((k) => lower.includes(k.toLowerCase()));
        if (!matches) continue;
      }

      listener.callback({ raw: rawSms, transaction, category });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[expo-transaction-sms-reader] listener threw: ${(e as Error).message}`);
    }
  }
}

function attachNativeIfNeeded(seedOptions: ActiveListener['options']): void {
  if (!nativeSubscription) {
    nativeSubscription = NativeModule.addListener('onSmsReceived', (event) => {
      // Native passes either the raw SMS directly or wrapped under `.raw` —
      // accept both shapes for forwards compatibility.
      const wrapper = event as unknown as { raw?: RawSmsMessage } & RawSmsMessage;
      const rawSms: RawSmsMessage = wrapper.raw ?? (wrapper as RawSmsMessage);
      dispatchSmsEvent(rawSms);
    });

    NativeModule.startListening({
      deduplicate: seedOptions.deduplicate,
      extraKeywords: seedOptions.extraKeywords,
    }).catch(() => {
      // Surfaced via the onError event listener below.
    });
  }

  if (!errorSubscription) {
    errorSubscription = NativeModule.addListener('onError', (e) => {
      // eslint-disable-next-line no-console
      console.warn(`[expo-transaction-sms-reader] ${e.code}: ${e.message}`);
    });
  }
}

function detachNativeIfIdle(): void {
  if (listeners.size > 0) return;
  if (nativeSubscription) {
    nativeSubscription.remove();
    nativeSubscription = null;
  }
  if (errorSubscription) {
    errorSubscription.remove();
    errorSubscription = null;
  }
  NativeModule.stopListening().catch(() => undefined);
}

/**
 * Subscribe to live SMS events. The callback fires for every incoming SMS
 * (subject to `minConfidence` / `extraKeywords` / `senderAllowlist`) with
 * both the raw message and a parsed transaction (or `null` if no parser
 * produced a result).
 *
 * Calling this implicitly starts the native broadcast receiver — there is no
 * need to call {@link startListening} separately. Multiple subscribers are
 * supported; the native receiver is unregistered automatically when the last
 * subscription is removed.
 *
 * @returns an `EventSubscription` — call `.remove()` to unsubscribe.
 */
export function addSmsListener(
  callback: (event: SmsReceivedEvent) => void,
  options: StartListeningOptions = {}
): EventSubscription {
  ensureAndroid('addSmsListener');

  const listener: ActiveListener = {
    callback,
    options: {
      minConfidence: options.minConfidence ?? 0,
      extraKeywords: options.extraKeywords ?? [],
      deduplicate: options.deduplicate ?? true,
      ignoreOtp: options.ignoreOtp ?? false,
      senderAllowlist: normaliseSenderList(options.senderAllowlist),
    },
  };

  listeners.add(listener);
  attachNativeIfNeeded(listener.options);

  return {
    remove: () => {
      listeners.delete(listener);
      detachNativeIfIdle();
    },
  };
}

/**
 * Lower-level alternative to {@link addSmsListener} — explicitly starts the
 * broadcast receiver without registering a JS callback. Useful when another
 * subsystem (e.g. a foreground service) handles delivery itself, or when you
 * need the receiver running for the side-effect alone.
 */
export async function startListening(options: StartListeningOptions = {}): Promise<void> {
  ensureAndroid('startListening');
  await NativeModule.startListening({
    deduplicate: options.deduplicate ?? true,
    extraKeywords: options.extraKeywords ?? [],
  });
}

/** Stop the native broadcast receiver. Safe to call when not listening. */
export async function stopListening(): Promise<void> {
  if (!isAndroid) return;
  // Forcibly clear all listeners and detach native — explicit stop is a
  // hard-stop, not the ref-counted version.
  listeners.clear();
  if (nativeSubscription) {
    nativeSubscription.remove();
    nativeSubscription = null;
  }
  if (errorSubscription) {
    errorSubscription.remove();
    errorSubscription = null;
  }
  await NativeModule.stopListening();
}

/** Whether the broadcast receiver is currently registered. */
export function isListening(): boolean {
  if (!isAndroid) return false;
  return NativeModule.isListening();
}

// ---------------------------------------------------------------------------
// Inbox query
// ---------------------------------------------------------------------------

/**
 * Reads recent SMS from the system inbox. Requires `READ_SMS` to have been
 * granted — call {@link requestPermissionsAsync} first.
 *
 * Pairs each raw SMS with a parsed transaction (or `null`). Sorted newest
 * first. Throws {@link SmsPermissionError} when called without permission.
 */
export async function getRecentMessages(
  options: GetRecentMessagesOptions = {}
): Promise<Array<{ raw: RawSmsMessage; transaction: ParsedTransaction | null }>> {
  ensureAndroid('getRecentMessages');

  const status = await getPermissionStatusAsync();
  if (status !== 'granted') {
    throw new SmsPermissionError(
      `READ_SMS not granted (status: ${status}). Call requestPermissionsAsync() first.`
    );
  }

  const limit = Math.min(options.limit ?? 50, 500);
  const sinceTimestamp = options.sinceTimestamp ?? 0;
  const minConfidence = options.minConfidence ?? 0;
  const allowlist = normaliseSenderList(options.senderAllowlist);

  // The native side takes a list of indicator keywords so it can pre-filter
  // at the SQL layer when `onlyTransactions` is true. We pass *strong*
  // past-tense verbs only — broader words like "balance" / "wallet" /
  // "credit" are too lenient and pull in promo SMS at the SQL layer, which
  // are then rejected by the JS parser anyway. Keeping the hint tight saves
  // I/O and keeps behaviour consistent with `parseTransactionSms`.
  const onlyTransactionsHint = options.onlyTransactions
    ? [
        'debited',
        'credited',
        'deducted',
        'withdrawn',
        'transferred',
        'received from',
        'received in',
        'deposited',
        'refunded',
        'has been charged',
        'was charged',
        'credit alert',
        'debit alert',
      ]
    : [];

  const rows = await NativeModule.getRecentMessages({ limit, sinceTimestamp, onlyTransactionsHint });

  const out: Array<{ raw: RawSmsMessage; transaction: ParsedTransaction | null }> = [];
  for (const raw of rows) {
    if (!senderMatches(allowlist, raw.address)) continue;
    const transaction = runParsers(raw, customParsers);
    if (minConfidence > 0 && (!transaction || transaction.confidence < minConfidence)) continue;
    out.push({ raw, transaction });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Aggregation utilities — pure JS, work on any ParsedTransaction[].
// ---------------------------------------------------------------------------

const EMPTY_CHANNEL_BUCKETS: Record<TransactionChannel, { credit: number; debit: number; count: number }> = {
  UPI: { credit: 0, debit: 0, count: 0 },
  IMPS: { credit: 0, debit: 0, count: 0 },
  NEFT: { credit: 0, debit: 0, count: 0 },
  RTGS: { credit: 0, debit: 0, count: 0 },
  CARD: { credit: 0, debit: 0, count: 0 },
  ATM: { credit: 0, debit: 0, count: 0 },
  POS: { credit: 0, debit: 0, count: 0 },
  WALLET: { credit: 0, debit: 0, count: 0 },
  BANK_TRANSFER: { credit: 0, debit: 0, count: 0 },
  CHEQUE: { credit: 0, debit: 0, count: 0 },
  ONLINE: { credit: 0, debit: 0, count: 0 },
  UNKNOWN: { credit: 0, debit: 0, count: 0 },
};

/**
 * Roll an array of parsed transactions into per-currency / per-channel /
 * per-sender totals. Skips transactions below `minConfidence` (default 0.4)
 * since those are likely false positives.
 */
export function summarizeTransactions(
  txns: Array<ParsedTransaction | null | undefined>,
  options: SummarizeOptions = {}
): TransactionSummary {
  const minConfidence = options.minConfidence ?? 0.4;
  const filterCurrency = options.currency?.toUpperCase();

  const summary: TransactionSummary = {
    credit: 0,
    debit: 0,
    net: 0,
    count: 0,
    byCurrency: {},
    byChannel: JSON.parse(JSON.stringify(EMPTY_CHANNEL_BUCKETS)),
    bySender: {},
  };

  for (const t of txns) {
    if (!t || t.amount === null) continue;
    if (t.confidence < minConfidence) continue;
    if (t.status === 'FAILED') continue;
    const currency = (t.currency ?? 'UNKNOWN').toUpperCase();
    if (filterCurrency && currency !== filterCurrency) continue;

    const amount = t.amount;
    const senderKey = t.bankCode ?? t.sender;

    summary.byCurrency[currency] ??= { credit: 0, debit: 0, net: 0, count: 0 };
    summary.bySender[senderKey] ??= { credit: 0, debit: 0, count: 0 };

    if (t.type === 'CREDIT') {
      summary.credit += amount;
      summary.byCurrency[currency].credit += amount;
      summary.byChannel[t.channel].credit += amount;
      summary.bySender[senderKey].credit += amount;
    } else if (t.type === 'DEBIT') {
      summary.debit += amount;
      summary.byCurrency[currency].debit += amount;
      summary.byChannel[t.channel].debit += amount;
      summary.bySender[senderKey].debit += amount;
    }

    summary.byChannel[t.channel].count += 1;
    summary.bySender[senderKey].count += 1;
    summary.byCurrency[currency].count += 1;
    summary.count += 1;
  }

  summary.net = summary.credit - summary.debit;
  for (const code of Object.keys(summary.byCurrency)) {
    const b = summary.byCurrency[code];
    b.net = b.credit - b.debit;
  }
  return summary;
}

/**
 * Group an array of parsed transactions by an arbitrary key. Common picks
 * include `t => t.bankCode ?? t.sender`, `t => t.channel`, or
 * `t => new Date(t.timestamp).toDateString()`.
 */
export function groupTransactions<K extends string | number>(
  txns: Array<ParsedTransaction | null | undefined>,
  keyFn: (t: ParsedTransaction) => K
): Record<K, ParsedTransaction[]> {
  const out = {} as Record<K, ParsedTransaction[]>;
  for (const t of txns) {
    if (!t) continue;
    const k = keyFn(t);
    (out[k] ??= []).push(t);
  }
  return out;
}

/**
 * Filter parsed transactions down to a `[from, to]` time range (inclusive).
 * Both bounds are Unix epoch ms.
 */
export function filterByDateRange(
  txns: Array<ParsedTransaction | null | undefined>,
  from: number,
  to: number
): ParsedTransaction[] {
  return txns.filter((t): t is ParsedTransaction =>
    !!t && t.timestamp >= from && t.timestamp <= to
  );
}

/**
 * Render an amount using the parsed transaction's currency. Falls back to a
 * plain number when the currency is unknown. Uses `Intl.NumberFormat` under
 * the hood — the locale defaults to the device locale.
 *
 * @example
 *   formatAmount(t)              // "₹1,500.00" (en-IN)
 *   formatAmount(t, { locale: 'en-PK' }) // "PKR 1,500.00"
 */
export function formatAmount(
  t: Pick<ParsedTransaction, 'amount' | 'currency'>,
  options: { locale?: string; fallbackCurrency?: string } = {}
): string {
  if (t.amount === null) return '—';
  const currency = t.currency ?? options.fallbackCurrency;
  const locale = options.locale;
  try {
    if (currency) {
      return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(t.amount);
    }
  } catch {
    // Some currencies (rare ISO codes) throw on `Intl.NumberFormat` — fall through.
  }
  return new Intl.NumberFormat(locale).format(t.amount);
}

/**
 * Compute the signed delta a transaction makes to the user's balance:
 * positive for CREDIT, negative for DEBIT, `0` for UNKNOWN. Failed and
 * pending transactions return `0`.
 */
export function signedAmount(t: Pick<ParsedTransaction, 'type' | 'amount' | 'status'>): number {
  if (t.amount === null) return 0;
  if (t.status === 'FAILED' || t.status === 'PENDING') return 0;
  if (t.type === 'CREDIT') return t.amount;
  if (t.type === 'DEBIT') return -t.amount;
  return 0;
}

// Re-export a few constant maps for callers building their own UI.
export type { TransactionType, TransactionChannel };
