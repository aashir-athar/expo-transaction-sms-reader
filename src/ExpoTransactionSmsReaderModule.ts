import { NativeModule, requireNativeModule } from 'expo';

import type {
  ExpoTransactionSmsReaderEvents,
  RawSmsMessage,
  SmsPermissionStatus,
  StartListeningOptions,
} from './ExpoTransactionSmsReader.types';

/**
 * Thin TypeScript declaration of the Kotlin native module. Do not export this
 * directly — `index.ts` wraps it with permission/parser logic.
 */
declare class ExpoTransactionSmsReaderModule extends NativeModule<ExpoTransactionSmsReaderEvents> {
  /** Returns the current Android permission status (READ_SMS + RECEIVE_SMS). */
  getPermissionStatusAsync(): Promise<SmsPermissionStatus>;

  /** Prompts the user for SMS permissions. Resolves with the resulting status. */
  requestPermissionsAsync(): Promise<SmsPermissionStatus>;

  /** Registers the broadcast receiver for `SMS_RECEIVED`. Idempotent. */
  startListening(options: Required<Pick<StartListeningOptions, 'deduplicate'>> & {
    extraKeywords: string[];
  }): Promise<void>;

  /** Unregisters the receiver. Safe to call when not listening. */
  stopListening(): Promise<void>;

  /** Returns whether the module is currently registered for SMS broadcasts. */
  isListening(): boolean;

  /** Reads from the SMS content provider. Requires READ_SMS. */
  getRecentMessages(options: {
    limit: number;
    sinceTimestamp: number;
    onlyTransactionsHint: string[];
  }): Promise<RawSmsMessage[]>;
}

// Will throw on iOS / web at import time — the public `index.ts` catches
// `requireNativeModule` errors and substitutes a no-op stub so consumers can
// still import the package on unsupported platforms.
export default requireNativeModule<ExpoTransactionSmsReaderModule>('ExpoTransactionSmsReader');
