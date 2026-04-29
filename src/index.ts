/**
 * `expo-transaction-sms-reader` — public API.
 *
 * Android-only. Wraps the Kotlin native module with:
 *   - permission helpers
 *   - typed listener subscriptions
 *   - heuristic transaction parser (extensible via custom parsers)
 *   - safe iOS/web stubs
 */

import { Platform, type EventSubscription } from 'expo-modules-core';

import NativeModule from './ExpoTransactionSmsReaderModule';
import { runParsers } from './parser';
import type {
  CustomParser,
  GetRecentMessagesOptions,
  ParsedTransaction,
  RawSmsMessage,
  SmsPermissionStatus,
  SmsReceivedEvent,
  StartListeningOptions,
} from './ExpoTransactionSmsReader.types';

export * from './ExpoTransactionSmsReader.types';
export { parseTransactionSms, isLikelyTransactionSms } from './parser';

// ---------------------------------------------------------------------------
// Internal state — kept module-scoped so `start/stopListening` are idempotent.
// ---------------------------------------------------------------------------

let nativeSubscription: EventSubscription | null = null;
let errorSubscription: EventSubscription | null = null;
const customParsers: CustomParser[] = [];

const isAndroid = Platform.OS === 'android';

function ensureAndroid(method: string): void {
  if (!isAndroid) {
    const err = new Error(
      `expo-transaction-sms-reader.${method}() is only available on Android. ` +
        `Current platform: ${Platform.OS}.`
    );
    err.name = 'UnsupportedPlatformError';
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Returns the current status for `READ_SMS` + `RECEIVE_SMS`.
 *
 * Resolves to `'denied'` on iOS/web — the package is Android-only, so there
 * is nothing to grant.
 */
export async function getPermissionStatusAsync(): Promise<SmsPermissionStatus> {
  if (!isAndroid) return 'denied';
  return NativeModule.getPermissionStatusAsync();
}

/**
 * Prompts the user to grant `READ_SMS` and `RECEIVE_SMS`. The prompt is shown
 * once per app session — repeated calls after a "Don't ask again" denial will
 * resolve to `'denied'`. Direct the user to system settings in that case.
 */
export async function requestPermissionsAsync(): Promise<SmsPermissionStatus> {
  if (!isAndroid) return 'denied';
  return NativeModule.requestPermissionsAsync();
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

/**
 * Subscribe to live SMS events. The callback fires for every incoming SMS
 * (subject to `minConfidence` / `extraKeywords`) with both the raw message
 * and a parsed transaction (or `null` if no parser produced a result).
 *
 * Calling this implicitly starts the native broadcast receiver — there is no
 * need to call {@link startListening} separately. The native receiver is
 * unregistered automatically when the last subscription is removed.
 *
 * @returns an `EventSubscription` — call `.remove()` to unsubscribe.
 */
export function addSmsListener(
  callback: (event: SmsReceivedEvent) => void,
  options: StartListeningOptions = {}
): EventSubscription {
  ensureAndroid('addSmsListener');

  const minConfidence = options.minConfidence ?? 0;
  const extraKeywords = options.extraKeywords ?? [];
  const deduplicate = options.deduplicate ?? true;

  // Lazily attach the native subscription on first listener.
  if (!nativeSubscription) {
    nativeSubscription = NativeModule.addListener('onSmsReceived', (event) => {
      // The native side passes the raw SMS only; we run parsers in JS so users
      // can hot-reload custom parsers without rebuilding the native module.
      const raw = (event as { raw: RawSmsMessage } | RawSmsMessage) as RawSmsMessage & {
        raw?: RawSmsMessage;
      };
      const rawSms: RawSmsMessage = raw.raw ?? (raw as RawSmsMessage);
      const transaction = runParsers(rawSms, customParsers);
      // Apply confidence filter at the JS layer so callers can change it without
      // a native rebuild.
      if (transaction && transaction.confidence < minConfidence) return;
      callback({ raw: rawSms, transaction });
    });

    NativeModule.startListening({ deduplicate, extraKeywords }).catch(() => {
      // Surfaced via the onError event listener below.
    });
  }

  // Surface native errors to the JS console — silent failures are the worst.
  if (!errorSubscription) {
    errorSubscription = NativeModule.addListener('onError', (e) => {
      // eslint-disable-next-line no-console
      console.warn(`[expo-transaction-sms-reader] ${e.code}: ${e.message}`);
    });
  }

  // Wrap in a subscription that detaches the native receiver when the last
  // user-level listener goes away.
  return {
    remove: () => {
      // The native module exposes a single multi-cast event; we just stop the
      // receiver entirely once all user-level subscriptions are gone. The
      // simple counting approach is good enough — listeners are cheap.
      if (nativeSubscription) {
        nativeSubscription.remove();
        nativeSubscription = null;
      }
      if (errorSubscription) {
        errorSubscription.remove();
        errorSubscription = null;
      }
      NativeModule.stopListening().catch(() => undefined);
    },
  };
}

/**
 * Lower-level alternative to {@link addSmsListener} — explicitly starts the
 * broadcast receiver without registering a JS callback. Useful when another
 * subsystem (e.g. a foreground service) handles delivery itself.
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
 * first.
 */
export async function getRecentMessages(
  options: GetRecentMessagesOptions = {}
): Promise<Array<{ raw: RawSmsMessage; transaction: ParsedTransaction | null }>> {
  ensureAndroid('getRecentMessages');

  const limit = Math.min(options.limit ?? 50, 500);
  const sinceTimestamp = options.sinceTimestamp ?? 0;

  // The native side takes a list of indicator keywords so it can pre-filter
  // at the SQL layer when `onlyTransactions` is true. We pass the same list
  // the JS parser uses to keep the behaviour consistent.
  const onlyTransactionsHint = options.onlyTransactions
    ? ['debited', 'credited', 'debit', 'credit', 'a/c', 'upi', 'imps', 'bal:', 'balance']
    : [];

  const rows = await NativeModule.getRecentMessages({ limit, sinceTimestamp, onlyTransactionsHint });
  return rows.map((raw) => ({
    raw,
    transaction: runParsers(raw, customParsers),
  }));
}
