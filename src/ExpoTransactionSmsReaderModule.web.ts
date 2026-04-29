/**
 * Web/iOS no-op fallback. Every method either rejects with
 * `UnsupportedPlatformError` or returns a sane default. Keeping a stub here
 * lets consumers build for web/iOS without a Metro/EAS error.
 */

import { NativeModule } from 'expo';

import type {
  ExpoTransactionSmsReaderEvents,
  RawSmsMessage,
  SmsPermissionStatus,
} from './ExpoTransactionSmsReader.types';

const PLATFORM_ERROR = new Error(
  'expo-transaction-sms-reader is Android-only — this method is a no-op on iOS / web.'
);
PLATFORM_ERROR.name = 'UnsupportedPlatformError';

class ExpoTransactionSmsReaderModuleStub extends NativeModule<ExpoTransactionSmsReaderEvents> {
  async getPermissionStatusAsync(): Promise<SmsPermissionStatus> {
    return 'denied';
  }
  async requestPermissionsAsync(): Promise<SmsPermissionStatus> {
    return 'denied';
  }
  async startListening(): Promise<void> {
    throw PLATFORM_ERROR;
  }
  async stopListening(): Promise<void> {
    /* no-op */
  }
  isListening(): boolean {
    return false;
  }
  async getRecentMessages(): Promise<RawSmsMessage[]> {
    return [];
  }
}

export default new ExpoTransactionSmsReaderModuleStub();
