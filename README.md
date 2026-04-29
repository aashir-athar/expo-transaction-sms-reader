<div align="center">

# 📩💸 expo-transaction-sms-reader

### Real-time **banking & wallet SMS** intelligence for Expo SDK 54 — Android-only.

Listen to incoming SMS in real-time, intelligently parse **banking, mobile-wallet, UPI and credit-card** notifications, and surface clean, typed transaction objects — built for **fintech, budgeting, and expense-tracking** apps in **Pakistan, India, Bangladesh** and beyond.

<br />

[![npm version](https://img.shields.io/npm/v/expo-transaction-sms-reader.svg?style=for-the-badge&color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/expo-transaction-sms-reader)
[![npm downloads](https://img.shields.io/npm/dm/expo-transaction-sms-reader.svg?style=for-the-badge&color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/expo-transaction-sms-reader)
[![Expo SDK](https://img.shields.io/badge/Expo%20SDK-54-000020.svg?style=for-the-badge&logo=expo&logoColor=white)](https://docs.expo.dev/versions/v54.0.0/)
[![Platform](https://img.shields.io/badge/platform-Android-3DDC84.svg?style=for-the-badge&logo=android&logoColor=white)](#-platform-support)

[![License](https://img.shields.io/npm/l/expo-transaction-sms-reader.svg?style=flat-square&color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?style=flat-square&logo=typescript&logoColor=white)](#)
[![Kotlin](https://img.shields.io/badge/Kotlin-native-7F52FF.svg?style=flat-square&logo=kotlin&logoColor=white)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](#-contributing)

```
SMS arrives  ─►  BroadcastReceiver  ─►  Parser  ─►  Typed Transaction  ─►  Your UI
                                          │
                                          └─ DEBIT · PKR 1,500.00 · ****1234 · ref TXN9823 · 0.85
```

</div>

---

## 📑 Table of contents

- [Why this exists](#-why-this-exists)
- [Features](#-features)
- [Platform support](#-platform-support)
- [Installation](#-installation)
- [Configuration](#%EF%B8%8F-configuration)
- [Quick start](#-quick-start)
- [Complete example](#-complete-example)
- [API reference](#-api-reference)
  - [Permissions](#permissions)
  - [Listening to live SMS](#listening-to-live-sms)
  - [Reading the inbox](#reading-the-inbox)
  - [Custom parsers](#custom-parsers)
  - [Pure parser utilities](#pure-parser-utilities)
- [Common patterns & recipes](#-common-patterns--recipes)
- [Confidence score guide](#-confidence-score-guide)
- [Type reference](#-type-reference)
- [Example output](#-example-output)
- [Platform safety (cross-platform builds)](#-platform-safety-cross-platform-builds)
- [Permissions & Google Play policy](#-permissions--google-play-policy)
- [Performance & battery](#-performance--battery)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [Roadmap](#%EF%B8%8F-roadmap)
- [License](#-license)

---

## 💡 Why this exists

Most fintech, budgeting, and expense-tracking apps in **South Asia** rely on parsing transaction SMS to give users a real-time picture of their money — banks here send SMS for every transaction, but few expose APIs.

The existing options are either **abandoned** (`react-native-android-sms-listener` — last published 2018), **bare React Native only** (no Expo support), or **don't parse anything** (just hand you the raw body). This package bundles everything you actually need: the listener, the inbox query, a heuristic parser tuned for South-Asian formats, and a Config Plugin that wires the manifest for you — built on the modern **Expo Modules API** for SDK 54.

---

## ✨ Features

- 📡 **Live SMS listening** — runtime-registered `BroadcastReceiver` for `SMS_RECEIVED`, no static manifest declaration (avoids Play Store SMS-policy review for *the module itself*).
- 🧠 **Heuristic transaction parser** — extracts type, amount, currency, sender, account mask, reference, balance, merchant, plus a confidence score in `[0, 1]`.
- 🇵🇰🇮🇳🇧🇩 **Tuned for South-Asian banks & wallets** — HBL, UBL, MCB, Meezan, Allied, Askari, Faysal, JazzCash, Easypaisa, SadaPay, NayaPay, HDFC, ICICI, SBI, Axis, Kotak, Paytm, PhonePe, GPay, BHIM, bKash, Nagad, Rocket, …
- 💱 **Multi-currency** — PKR, INR, BDT, USD, EUR, GBP, AED, SAR — with sender-based disambiguation for the ambiguous "Rs." prefix.
- 🧩 **Pluggable parsers** — register bank-specific overrides without rebuilding the native module.
- 📜 **Inbox query** — pull historical SMS via the system content provider, with optional transaction-only filtering at the SQL layer.
- 🔐 **Permission helpers** — `getPermissionStatusAsync` + `requestPermissionsAsync` first-class.
- 🛡️ **Privacy-conscious** — nothing is persisted by the module; all parsing happens locally.
- 🧱 **Pure Expo Modules API** — Kotlin native, fully typed TS surface, ships a Config Plugin.
- 🚦 **Cross-platform safe** — imports cleanly on iOS / web; runtime methods either no-op or throw `UnsupportedPlatformError`.
- 🪶 **Tiny footprint** — no extra runtime dependencies beyond `expo-modules-core`; coroutines for off-main-thread inbox reads.

---

## 📱 Platform support

| Platform | Status                                                  |
|----------|---------------------------------------------------------|
| Android  | ✅ Fully supported (API 24+, tested on API 24 → 35)      |
| iOS      | ❌ **Not supported** — Apple does not allow SMS reading  |
| Web      | ❌ Not supported (no SMS APIs in the browser)            |

> **iOS is intentionally a no-op stub.** The package can still be imported on iOS builds — every method either resolves to a sane default or throws `UnsupportedPlatformError`. See [Platform safety](#-platform-safety-cross-platform-builds).

---

## 📦 Installation

```bash
npx expo install expo-transaction-sms-reader
```

Then **prebuild and rebuild** the native project — this package ships native Kotlin so it cannot run inside **Expo Go**. You need a custom dev client.

```bash
npx expo prebuild --clean
npx expo run:android
```

> 💡 **EAS users:** add the package, commit, and the next `eas build --profile development --platform android` will pick it up automatically. No further wiring needed.

### Requirements

- Expo SDK **54** or newer
- React Native **0.81+** (bundled with SDK 54)
- Android **API 24+** (Android 7.0 Nougat)
- A **physical Android device** for end-to-end testing — emulators don't deliver real SMS

---

## ⚙️ Configuration

Add the bundled **Config Plugin** to your `app.json` / `app.config.ts`. It injects the required Android permissions (`READ_SMS`, `RECEIVE_SMS`) into your merged manifest at prebuild time.

```json
{
  "expo": {
    "plugins": ["expo-transaction-sms-reader"]
  }
}
```

If your app already declares the SMS permissions itself, opt out with the `skip` flag:

```json
{
  "expo": {
    "plugins": [
      ["expo-transaction-sms-reader", { "android": { "skip": true } }]
    ]
  }
}
```

Re-prebuild after adding the plugin:

```bash
npx expo prebuild --clean
```

> ⚠️ **Heads-up:** Apps requesting `READ_SMS` / `RECEIVE_SMS` need approval through Google's [Permissions Declaration form](https://support.google.com/googleplay/android-developer/answer/10208820). This is a release-blocker, not a code issue — see [Permissions & Google Play policy](#-permissions--google-play-policy).

---

## 🚀 Quick start

```tsx
import {
  requestPermissionsAsync,
  addSmsListener,
} from 'expo-transaction-sms-reader';

await requestPermissionsAsync();

const sub = addSmsListener(({ raw, transaction }) => {
  if (transaction && transaction.confidence >= 0.6) {
    console.log(`${transaction.type} ${transaction.currency} ${transaction.amount}`);
  }
});

// later — clean up
sub.remove();
```

That's it. The native receiver is started lazily on the first listener and torn down when the last subscription is removed.

---

## 📘 Complete example

A production-shaped React Native screen — handles permission flow, denied / "don't ask again" cases, inbox backfill on first launch, and live updates.

```tsx
import { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Button,
  FlatList,
  Linking,
  SafeAreaView,
  Text,
  View,
} from 'react-native';
import {
  addSmsListener,
  getPermissionStatusAsync,
  getRecentMessages,
  requestPermissionsAsync,
  type ParsedTransaction,
  type SmsPermissionStatus,
} from 'expo-transaction-sms-reader';

export default function TransactionsScreen() {
  const [status, setStatus] = useState<SmsPermissionStatus>('undetermined');
  const [txns, setTxns] = useState<ParsedTransaction[]>([]);
  const [loading, setLoading] = useState(false);

  // 1. Resolve current permission status on mount.
  useEffect(() => {
    getPermissionStatusAsync().then(setStatus);
  }, []);

  // 2. Permission flow with graceful fallback to system settings.
  const requestPermission = useCallback(async () => {
    const next = await requestPermissionsAsync();
    setStatus(next);
    if (next !== 'granted') {
      Alert.alert(
        'SMS access needed',
        'We use SMS to detect your transactions automatically. Open settings to grant access.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open settings', onPress: () => Linking.openSettings() },
        ],
      );
    }
  }, []);

  // 3. Backfill the inbox once permission is granted.
  useEffect(() => {
    if (status !== 'granted') return;
    setLoading(true);
    getRecentMessages({ limit: 200, onlyTransactions: true })
      .then((rows) => {
        setTxns(
          rows
            .map((r) => r.transaction)
            .filter((t): t is ParsedTransaction => t !== null && t.confidence >= 0.5),
        );
      })
      .finally(() => setLoading(false));
  }, [status]);

  // 4. Subscribe to live SMS. The receiver auto-starts and auto-stops with the listener.
  useEffect(() => {
    if (status !== 'granted') return;

    const sub = addSmsListener(
      ({ transaction }) => {
        if (transaction && transaction.confidence >= 0.5) {
          setTxns((prev) => [transaction, ...prev]);
        }
      },
      { minConfidence: 0.4, deduplicate: true },
    );

    return () => sub.remove();
  }, [status]);

  if (status !== 'granted') {
    return (
      <SafeAreaView style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
        <Text style={{ fontSize: 18, marginBottom: 16 }}>
          SMS permission: {status}
        </Text>
        <Button title="Grant SMS access" onPress={requestPermission} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <FlatList
        data={txns}
        keyExtractor={(t, i) => `${t.timestamp}-${t.reference ?? i}`}
        ListHeaderComponent={
          loading ? <Text style={{ padding: 16 }}>Loading inbox…</Text> : null
        }
        renderItem={({ item }) => (
          <View style={{ padding: 16, borderBottomWidth: 1, borderColor: '#eee' }}>
            <Text style={{ fontSize: 16, fontWeight: '600' }}>
              {item.type === 'CREDIT' ? '+' : '−'} {item.currency ?? ''} {item.amount?.toFixed(2)}
            </Text>
            <Text style={{ color: '#444' }}>
              {item.sender}{item.merchant ? ` · ${item.merchant}` : ''}
            </Text>
            <Text style={{ color: '#888', fontSize: 12 }}>
              {item.account ?? '—'} · ref {item.reference ?? '—'} · conf {item.confidence.toFixed(2)}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
```

---

## 📚 API reference

### Permissions

#### `getPermissionStatusAsync(): Promise<SmsPermissionStatus>`

Returns the current status for `READ_SMS` + `RECEIVE_SMS`. Values: `'granted' | 'denied' | 'undetermined'`. Resolves to `'denied'` on iOS / web (no concept of granting SMS access on those platforms).

#### `requestPermissionsAsync(): Promise<SmsPermissionStatus>`

Prompts the user with the system permission dialog. After a `"Don't ask again"` denial, Android suppresses subsequent prompts and this method returns `'denied'` immediately — direct the user to system settings via `Linking.openSettings()` from `react-native`.

---

### Listening to live SMS

#### `addSmsListener(callback, options?): EventSubscription`

Subscribe to live SMS events. The callback fires for every incoming SMS with both the raw message and a parsed transaction (or `null` if no parser produced a result). The native receiver starts lazily on the first listener and tears down when the last subscription is removed.

```ts
const sub = addSmsListener(
  ({ raw, transaction }) => {
    // raw is always present
    // transaction is null for non-financial SMS (OTPs, promos, …)
  },
  {
    minConfidence: 0.5,        // [default 0] drop parses below this score
    deduplicate: true,         // [default true] suppress same address+body within 5s
    extraKeywords: ['promo'],  // [default []] also emit on these substring hits
  },
);

sub.remove();
```

> 🧠 **`minConfidence` is enforced in JS** so you can change it without a native rebuild. Use [the confidence guide](#-confidence-score-guide) to pick the right threshold.

#### `startListening(options?): Promise<void>` / `stopListening(): Promise<void>` / `isListening(): boolean`

Lower-level, callback-less control over the native receiver. Useful when delivery is handled elsewhere (e.g. a foreground service that you maintain at the app layer). Most apps should use `addSmsListener` instead.

```ts
await startListening({ deduplicate: true, extraKeywords: [] });
console.log(isListening()); // → true
await stopListening();
```

---

### Reading the inbox

#### `getRecentMessages(options?): Promise<{ raw: RawSmsMessage; transaction: ParsedTransaction | null }[]>`

Reads from the system SMS content provider. Requires `READ_SMS` to have been granted. Sorted **newest first**. Each row pairs the raw SMS with a parsed transaction (or `null` if no parser produced a result).

```ts
const rows = await getRecentMessages({
  limit: 100,             // [default 50, capped at 500]
  sinceTimestamp: 0,      // [default 0] Unix epoch ms; 0 = no lower bound
  onlyTransactions: true, // [default false] pre-filter at the SQL layer
});
```

`onlyTransactions: true` filters at the **native SQL layer** before the data crosses the JS bridge — much faster on large inboxes than filtering in JS afterwards.

---

### Custom parsers

#### `registerParser(parser): () => void`

Register a parser that runs **before** the built-in heuristic parser. The first parser to return a non-null `ParsedTransaction` wins; if none match, the default heuristic parser runs.

```ts
import { registerParser, parseTransactionSms } from 'expo-transaction-sms-reader';

const unregister = registerParser((raw) => {
  if (!raw.address.toUpperCase().includes('MEEZAN')) return null;
  // Reuse the default parser, then layer your overrides on top.
  const parsed = parseTransactionSms(raw);
  if (!parsed) return null;
  return { ...parsed, sender: 'Meezan Bank', confidence: 0.95 };
});

// later, e.g. on logout
unregister();
```

> 🛡️ Custom parsers must **never throw** — exceptions are caught by the runtime and the parser is silently skipped. If you need to log debug info, wrap your code in `try/catch` and emit your own log.

#### `clearParsers(): void`

Remove every registered parser. Useful in tests.

---

### Pure parser utilities

These work standalone — handy for **unit tests**, **batch processing exported message dumps**, or running parsers on data from elsewhere (e.g. a server-side ingest pipeline).

#### `parseTransactionSms(raw: RawSmsMessage): ParsedTransaction | null`

Run the built-in heuristic parser on a single SMS. Returns `null` only when the message clearly is not a transaction (no indicator keywords AND no detectable amount). Otherwise always returns a `ParsedTransaction` — inspect `confidence` to gauge reliability.

#### `isLikelyTransactionSms(body: string): boolean`

Quick boolean check: does this SMS body even look like a transaction? Used internally by `getRecentMessages({ onlyTransactions: true })` and exposed for callers who want the same heuristic.

---

## 🎯 Common patterns & recipes

### Backfill + live listener

The pattern from the [complete example](#-complete-example), distilled:

```ts
const recent = await getRecentMessages({ limit: 200, onlyTransactions: true });
setTxns(recent.flatMap((r) => (r.transaction ? [r.transaction] : [])));

const sub = addSmsListener(({ transaction }) => {
  if (transaction) setTxns((prev) => [transaction, ...prev]);
});
```

### Filter only debits (spending tracker)

```ts
addSmsListener(({ transaction }) => {
  if (transaction?.type === 'DEBIT' && transaction.confidence >= 0.6) {
    addToSpendingLog(transaction);
  }
});
```

### Filter by bank

```ts
const ALLOWED = ['HBL', 'UBL', 'MEEZAN', 'JAZZCASH'];
addSmsListener(({ raw, transaction }) => {
  if (!ALLOWED.some((b) => raw.address.toUpperCase().includes(b))) return;
  if (transaction) saveTransaction(transaction);
});
```

### Persist with AsyncStorage

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

addSmsListener(async ({ transaction }) => {
  if (!transaction || transaction.confidence < 0.5) return;
  const existing = JSON.parse((await AsyncStorage.getItem('txns')) ?? '[]');
  await AsyncStorage.setItem('txns', JSON.stringify([transaction, ...existing]));
});
```

### Bank-specific custom parser

```ts
registerParser((raw) => {
  // HBL Pakistan format: "Tx ID: ABC12345 / Rs.1500.00 Dr from..."
  if (!raw.address.toUpperCase().includes('HBL')) return null;
  const txMatch = /Tx\s*ID[:\s]+([A-Z0-9]+)/i.exec(raw.body);
  const amtMatch = /Rs\.?\s*([\d,.]+)/i.exec(raw.body);
  return {
    type: /Dr\b/i.test(raw.body) ? 'DEBIT' : 'CREDIT',
    amount: amtMatch ? Number(amtMatch[1].replace(/,/g, '')) : null,
    currency: 'PKR',
    sender: 'HBL Pakistan',
    account: null,
    balance: null,
    reference: txMatch?.[1] ?? null,
    merchant: null,
    timestamp: raw.timestamp,
    confidence: 0.95,
    raw,
  };
});
```

### Cross-platform safe import (iOS/web builds)

```ts
import { Platform } from 'react-native';
import { addSmsListener } from 'expo-transaction-sms-reader';

if (Platform.OS === 'android') {
  addSmsListener(handler);
}
```

---

## 🎚️ Confidence score guide

The parser assigns a confidence in `[0, 1]` based on how many signals it could extract. Pick a threshold based on your tolerance for false positives:

| Threshold | Use case                                      | Trade-off                                                       |
|-----------|-----------------------------------------------|------------------------------------------------------------------|
| `≥ 0.4`   | Show in a "raw stream" debug view             | Catches almost everything; some false positives                  |
| `≥ 0.5`   | Auto-categorise into "needs review" bucket    | Balanced — recommended default for a UI list                     |
| `≥ 0.7`   | Auto-add to a budgeting ledger                | High precision; some real transactions will fall through         |
| `≥ 0.85`  | Auto-trigger spend alerts / budget overrun UX | Only fully-extracted transactions; will miss exotic SMS formats  |

Confidence is built up additively: indicator keywords (+0.25), an extracted amount (+0.25), a known type (+0.15), then `+0.1` each for currency/account/reference and `+0.05` for balance. Maxes out at `0.95`.

---

## 🧰 Type reference

```ts
type TransactionType = 'CREDIT' | 'DEBIT' | 'UNKNOWN';
type SmsPermissionStatus = 'granted' | 'denied' | 'undetermined';

interface RawSmsMessage {
  /** Internal id from the SMS content provider; null for live broadcasts. */
  id: string | null;
  /** Originating address — bank short code or phone number. */
  address: string;
  /** Full SMS body (multipart messages are pre-concatenated). */
  body: string;
  /** Unix epoch ms when the device received the message. */
  timestamp: number;
  /** SIM slot index when reported by the OS; null on single-SIM / older Android. */
  subscriptionId: number | null;
}

interface ParsedTransaction {
  type: TransactionType;
  amount: number | null;
  currency: string | null;   // ISO-4217 (PKR, INR, BDT, USD, …) or null
  sender: string;            // Bank / wallet / short code that sent the SMS
  account: string | null;    // Card or account mask, e.g. "****1234"
  balance: number | null;    // Available balance after the txn, when present
  reference: string | null;  // TXN id / RRN / UTR / UPI ref
  merchant: string | null;   // Counterparty extracted via "at"/"to"/"from"
  timestamp: number;
  confidence: number;        // [0, 1] — see Confidence score guide
  raw: RawSmsMessage;        // Original SMS, for fallback parsing or audit
}

interface SmsReceivedEvent {
  raw: RawSmsMessage;
  transaction: ParsedTransaction | null;
}

interface StartListeningOptions {
  minConfidence?: number;   // default 0
  extraKeywords?: string[]; // default []
  deduplicate?: boolean;    // default true
}

interface GetRecentMessagesOptions {
  limit?: number;           // default 50, capped at 500
  sinceTimestamp?: number;  // default 0
  onlyTransactions?: boolean; // default false
}

type CustomParser = (raw: RawSmsMessage) => ParsedTransaction | null;
```

All types are exported from the package root:

```ts
import type {
  RawSmsMessage,
  ParsedTransaction,
  SmsReceivedEvent,
  StartListeningOptions,
  GetRecentMessagesOptions,
  CustomParser,
  TransactionType,
  SmsPermissionStatus,
} from 'expo-transaction-sms-reader';
```

---

## 🧪 Example output

| SMS body                                                                                        | Parsed                                                                  |
|-------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| `Rs. 1,500.00 debited from A/C ****1234 on 12-Jan. Avbl Bal Rs.45,200. Ref: TXN98237. -HBL`     | `DEBIT · PKR 1500 · acct ****1234 · ref TXN98237 · bal 45200 · 0.85`    |
| `Credit Alert: PKR 25,000.00 received in your JazzCash wallet. TID: JC8721KQ`                   | `CREDIT · PKR 25000 · ref JC8721KQ · 0.80`                              |
| `INR 499.00 spent on HDFC Card xx9921 at AMAZON IN. Avl bal INR 8,210.45. Ref 401923`           | `DEBIT · INR 499 · acct xx9921 · merchant AMAZON IN · ref 401923 · 0.90` |
| `Sent BDT 2,500.00 to Rahim from your bKash A/C. TrxID: 9C8S2TXY. Bal BDT 14,300.50.`           | `DEBIT · BDT 2500 · merchant Rahim · ref 9C8S2TXY · bal 14300.50 · 0.85` |
| `OTP 824931 valid 5 mins. Do not share.`                                                        | `null` (not a transaction)                                              |
| `Get 50% off on your next Foodpanda order — code SAVE50`                                        | `null` (not a transaction)                                              |

---

## 🧷 Platform safety (cross-platform builds)

The package can be imported on any platform — calling Android-only methods on iOS / web behaves predictably:

| Method                          | iOS / web behaviour                          |
|---------------------------------|----------------------------------------------|
| `getPermissionStatusAsync()`    | resolves to `'denied'`                       |
| `requestPermissionsAsync()`     | resolves to `'denied'`                       |
| `addSmsListener()`              | throws `UnsupportedPlatformError`            |
| `startListening()`              | throws `UnsupportedPlatformError`            |
| `stopListening()`               | resolves (no-op)                             |
| `isListening()`                 | returns `false`                              |
| `getRecentMessages()`           | throws `UnsupportedPlatformError`            |
| `parseTransactionSms()`         | works (pure JS — no native bridge)           |
| `isLikelyTransactionSms()`      | works (pure JS — no native bridge)           |
| `registerParser()`              | works (pure JS — no native bridge)           |

For maximum safety, gate runtime calls behind `Platform.OS === 'android'`.

---

## 🛡 Permissions & Google Play policy

This is the part that catches almost every first-time SMS-package author by surprise. Read carefully **before** you ship.

### What we need

- `android.permission.READ_SMS` — read the system SMS inbox via the content provider
- `android.permission.RECEIVE_SMS` — receive `SMS_RECEIVED` broadcasts in real-time

The Config Plugin injects both into the merged `AndroidManifest.xml` for you.

### What Google requires

Google classifies these as **restricted permissions**. Apps requesting them are auto-rejected from the Play Store unless the developer:

1. **Submits the [Permissions Declaration form](https://support.google.com/googleplay/android-developer/answer/10208820)** in Play Console.
2. **Selects an approved use-case** — for budgeting / expense / fintech apps, the relevant category is **"Financial features that require SMS access to function"**.
3. **Provides a screen recording** showing the user granting permission and the app actually using SMS data on-device.
4. **Links to a privacy policy** that explicitly states no SMS body leaves the device.

Allow **3–10 business days** for review. First submissions are commonly rejected once for missing demo footage; resubmit with the requested clip.

> 🚨 **This is a release-blocker, not a code issue.** Debug builds work without it. Production listings do not. Plan for the review window in your launch schedule.

---

## ⚡ Performance & battery

- **Cold start:** the receiver registers in <5 ms. Inbox queries run on the IO dispatcher and don't block the JS thread.
- **Memory:** the de-dup ring buffer holds at most 32 entries (`address|hash` pairs). Cleared on `stopListening()`.
- **Battery:** SMS broadcasts wake the app for ~50 ms each. On a phone receiving 30 transaction SMS/day, expected impact is well under 0.1% of battery.
- **Process death:** if the OEM (Xiaomi, Vivo, OnePlus, …) kills your background process, broadcasts queued while dead will not be delivered. Either:
  - Document the OEM "autostart" toggle for end users, or
  - Run a foreground service at the app layer to keep the process alive (out of scope for this module).

> ⚙️ **Threading:** all SMS broadcasts are dispatched to the JS thread via Expo's event bridge. If your handler is heavy (e.g. saves to a remote DB), wrap it in `setImmediate` / a queue to avoid blocking ingest.

---

## 🛠 Troubleshooting

<details>
<summary><b>Permission keeps resolving to <code>'denied'</code> even after the dialog</b></summary>

The user likely tapped **"Don't ask again"** on a previous denial. Android suppresses subsequent prompts. Direct them to system settings instead:

```ts
import { Linking } from 'react-native';

// Opens your app's permission page directly — no extra deps required.
await Linking.openSettings();
```
</details>

<details>
<summary><b>No events firing in production (works in dev)</b></summary>

The three usual suspects, in order:

1. **Battery optimization** is killing your background process. Educate users to add your app to the "Unrestricted battery" list, or run a foreground service.
2. **OEM autostart** — Xiaomi, Vivo, Oppo, OnePlus all require a manual toggle that no API can flip. Document it in your onboarding.
3. The receiver was started **before permission was granted**. Always check `getPermissionStatusAsync()` first.
</details>

<details>
<summary><b>Duplicate events for the same SMS</b></summary>

Already handled — the receiver de-duplicates by `(address, body)` within a 5-second window. If you're still seeing dupes:
- Make sure you only call `addSmsListener` once (a re-render that re-attaches the listener will multi-cast).
- Set `deduplicate: true` explicitly (it's the default, but easy to typo away).
- Check you don't have a separate `startListening()` call competing with `addSmsListener`.
</details>

<details>
<summary><b>Parser returns the wrong amount / type for my bank</b></summary>

Register a custom parser:

```ts
import { registerParser, parseTransactionSms } from 'expo-transaction-sms-reader';

registerParser((raw) => {
  if (raw.address !== 'MY-BANK') return null;
  const parsed = parseTransactionSms(raw);
  return parsed && { ...parsed, /* your overrides */ };
});
```

Then please [open a PR](#-contributing) with a redacted test fixture so we can fix the default heuristics for everyone. 🙏
</details>

<details>
<summary><b><code>UnsupportedPlatformError</code> on iOS / web</b></summary>

Expected — the package is Android-only. Wrap calls behind `Platform.OS === 'android'` for cross-platform builds. See [Platform safety](#-platform-safety-cross-platform-builds).
</details>

<details>
<summary><b>Play Store rejection: "Use of restricted permissions"</b></summary>

You skipped (or failed) the Permissions Declaration. See [Permissions & Google Play policy](#-permissions--google-play-policy) for the recovery path.
</details>

<details>
<summary><b>"Module not found: Can't resolve 'expo-transaction-sms-reader'"</b></summary>

Three common causes:

1. You haven't run `npx expo prebuild --clean` after installing — Expo autolinking needs the prebuild step.
2. You're trying to run inside **Expo Go** — switch to a custom dev client (`npx expo run:android`).
3. Stale `node_modules`. Run `rm -rf node_modules android/.gradle && npx expo prebuild --clean`.
</details>

---

## 🤝 Contributing

PRs welcome! Especially valued:

- **Bank fixtures** — drop your country's SMS samples (PII redacted: replace digits with `X`s, names with placeholders) into `__tests__/fixtures/`.
- **New currencies** — extend `CURRENCY_MAP` and `SENDER_COUNTRY_HINTS` in [src/parser.ts](./src/parser.ts).
- **Custom-parser presets** — bundled overrides for popular banks would be great.
- **Platform stubs** — better iOS DX (e.g. integration with `expo-notifications` for similar fintech UX).

Run the test suite:

```bash
npm install
npm run test
npm run lint
```

> 🪟 **Windows contributors:** `expo-module-scripts` ships its lifecycle helpers as bash scripts, which Node mis-parses on Windows (`set -eo pipefail` syntax error). Workarounds: use **WSL**, or skip the wrappers and run TypeScript directly — `npm install --ignore-scripts`, then `npx tsc -p tsconfig.json && npx tsc -p plugin/tsconfig.json`. Publishing also needs `npm publish --ignore-scripts`. macOS / Linux / CI are unaffected.

For a full release / publish guide, see [ZERO-TO-DEPLOY.md](./ZERO-TO-DEPLOY.md).

---

## 🗺️ Roadmap

- [ ] Bundled parser presets for 20+ South-Asian banks
- [ ] iOS hand-off recipe (push notifications from a server-side parser)
- [ ] Optional foreground-service helper for OEMs that aggressively kill background processes
- [ ] Web stub backed by a stub `MessagePort` for unit-testing parser logic in CI
- [ ] Built-in metrics (counts of CREDIT / DEBIT / unknown for analytics dashboards)

Have an idea? [Open an issue](https://github.com/aashir-athar/expo-transaction-sms-reader/issues/new).

---

## 📄 License

[MIT](./LICENSE) © 2026 expo-transaction-sms-reader contributors

---

<div align="center">

### Built with ❤️ for fintech builders in 🇵🇰 Pakistan, 🇮🇳 India, 🇧🇩 Bangladesh, and beyond.

If this saved you time, please [⭐ star the repo](https://github.com/aashir-athar/expo-transaction-sms-reader) — it helps others discover it.

</div>
