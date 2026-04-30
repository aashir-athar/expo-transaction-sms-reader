<div align="center">

# expo-transaction-sms-reader

### Real-time **banking & wallet SMS** intelligence for Expo SDK 54 — Android-only.

Listen to incoming SMS in real-time, intelligently parse **banking, mobile-wallet, UPI, NEFT, IMPS, RTGS, ATM, POS and credit-card** notifications, classify each message (`TRANSACTION` / `OTP` / `PROMOTIONAL` / `OTHER`), extract OTPs for autofill, and aggregate everything into clean, typed objects — built for **fintech, budgeting, expense-tracking, and digital-wallet** apps in **Pakistan, India, Bangladesh, the GCC** and beyond.

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
SMS arrives  ─►  BroadcastReceiver  ─►  Classifier  ─►  Parser  ─►  Typed Transaction  ─►  Your UI
                                            │              │
                                            │              └─ DEBIT · PKR 1,500.00 · UPI · ****1234 · ref TXN9823 · 0.95
                                            │
                                            └─ TRANSACTION / OTP / PROMOTIONAL / OTHER
```

</div>

---

## Table of contents

- [Why this exists](#why-this-exists)
- [Features](#features)
- [Platform support](#platform-support)
- [Installation](#installation)
- [Configuration](#configuration)
- [Quick start](#quick-start)
- [Complete example](#complete-example)
- [API reference](#api-reference)
  - [Permissions](#permissions)
  - [Listening](#listening)
  - [Inbox query](#inbox-query)
  - [Parsing](#parsing)
  - [OTP detection](#otp-detection)
  - [Aggregation utilities](#aggregation-utilities)
  - [Custom parsers](#custom-parsers)
  - [Errors](#errors)
- [Supported banks & wallets](#supported-banks--wallets)
- [How the parser works](#how-the-parser-works)
- [Confidence model](#confidence-model)
- [FAQ & troubleshooting](#faq--troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

## Why this exists

Most "SMS reader" packages stop at giving you the raw message. That's the easy 10%. The hard 90% is turning **"Rs. 1,500.00 debited from a/c xx1234 via UPI/HDFCBK; UPI Ref 412345678; Avbl Bal: Rs. 23,450.00"** into:

```ts
{
  type: 'DEBIT',
  amount: 1500,
  currency: 'PKR',
  channel: 'UPI',
  status: 'SUCCESS',
  bankCode: 'HDFC',
  account: '****1234',
  balance: 23450,
  reference: '412345678',
  confidence: 0.95,
}
```

This package does that — across **60+ South-Asian, Indian, Bangladeshi, and GCC institutions** — in pure TypeScript so you can re-run it on any SMS string, anywhere, without rebuilding your native module.

It also does the parts everyone gets wrong:

- **OTP messages are excluded from transactions** (and surfaced via a separate API for autofill).
- **Failed / pending / reversed transactions are flagged** rather than counted as completed.
- **Currencies are disambiguated** by sender id (so "Rs" from `HDFCBK` is INR but from `HBL` is PKR).
- **Listeners are ref-counted** — multiple subscribers don't fight over the broadcast receiver.

---

## Features

- **Live SMS listener** — `BroadcastReceiver` registered at runtime (no `AndroidManifest`-declared receivers, so no Play Store SMS-policy review for that reason).
- **Inbox query** — read recent SMS from the system content provider, with date / keyword / sender / confidence filters.
- **Smart classifier** — every SMS is bucketed into `TRANSACTION`, `OTP`, `PROMOTIONAL`, or `OTHER`.
- **OTP extraction** — pull the digits out for autofill, with validity-window detection.
- **Heuristic transaction parser** — covers UPI, IMPS, NEFT, RTGS, ATM, POS, cards, wallets, cheques, online.
- **60+ banks & wallets recognised** — see [Supported banks & wallets](#supported-banks--wallets).
- **Channel detection** — `UPI` / `IMPS` / `NEFT` / `RTGS` / `CARD` / `ATM` / `POS` / `WALLET` / `BANK_TRANSFER` / `CHEQUE` / `ONLINE`.
- **Status detection** — `SUCCESS` / `PENDING` / `FAILED` / `UNKNOWN`.
- **Currency disambiguation** — sender registry resolves "Rs" between PKR / INR / LKR / NPR.
- **Aggregation utilities** — `summarizeTransactions`, `groupTransactions`, `filterByDateRange`, `formatAmount`, `signedAmount`.
- **Custom parsers** — register your own first-pass parser for bank-specific formats.
- **Permission helpers** — `granted` / `denied` / `undetermined` / `blocked` states + one-tap `openAppSettings`.
- **Ref-counted listener** — multiple `addSmsListener` calls share a single native receiver; the receiver detaches when the last subscription is removed.
- **Safe iOS / web stubs** — every method becomes a typed no-op so you can build cross-platform without conditionals everywhere.
- **Strict TypeScript** — `ParsedTransaction`, `RawSmsMessage`, `SmsCategory`, `TransactionChannel`, `TransactionStatus`, `TransactionSummary`, `ParsedOtp`, custom-parser type, error classes.

---

## Platform support

| Platform   | Status                                                         |
| ---------- | -------------------------------------------------------------- |
| Android 7+ | **Full support** (SDK 24+, tested on SDK 26 / 33 / 34 / 35).   |
| iOS        | No-op stub — every method returns sane defaults / throws `UnsupportedPlatformError` where relevant. |
| Web        | Same no-op stub.                                               |

iOS *cannot* read SMS by design — Apple does not expose any API for it, system-wide. There is no plan to add iOS support; this is a hardware-OS limitation, not a TODO.

---

## Installation

```bash
npx expo install expo-transaction-sms-reader
```

Or with raw npm/yarn/pnpm:

```bash
npm  install expo-transaction-sms-reader
yarn add     expo-transaction-sms-reader
pnpm add     expo-transaction-sms-reader
```

> Requires **Expo SDK 54** with the new architecture enabled (the default since SDK 51). Also requires a **dev client** — this is a native module, not Expo Go.

After install:

```bash
npx expo prebuild
npx expo run:android
```

---

## Configuration

### 1. Register the config plugin

In `app.json` / `app.config.ts`:

```json
{
  "expo": {
    "plugins": ["expo-transaction-sms-reader"]
  }
}
```

This adds `READ_SMS` and `RECEIVE_SMS` to your merged `AndroidManifest.xml`.

### 2. Optional plugin options

```jsonc
{
  "plugins": [
    ["expo-transaction-sms-reader", {
      "android": {
        // Skip permission injection entirely (e.g. you declare them yourself).
        "skip": false,
        // Or fine-grained — disable one of the two permissions.
        "permissions": { "read": true, "receive": true }
      }
    }]
  ]
}
```

| Option                            | Default | Effect                                                                       |
| --------------------------------- | ------- | ---------------------------------------------------------------------------- |
| `android.skip`                    | `false` | Skip injecting *both* permissions. Use when the host app declares them itself. |
| `android.permissions.read`        | `true`  | Inject `READ_SMS`. Disable if you only want the live listener (no inbox).    |
| `android.permissions.receive`     | `true`  | Inject `RECEIVE_SMS`. Disable if you only want to query the inbox.           |

### 3. Google Play Store policy

> **Important:** Apps requesting `READ_SMS` / `RECEIVE_SMS` must comply with Google's [SMS / Call Log Permissions Policy](https://support.google.com/googleplay/android-developer/answer/10208820). Expect a permissions-declaration form during review. The receiver in this package is **registered at runtime**, not in the manifest — that avoids the *separate* "default-handler-only" review for statically-declared SMS receivers.

---

## Quick start

```ts
import {
  ensurePermissionsAsync,
  addSmsListener,
} from 'expo-transaction-sms-reader';

async function start() {
  const status = await ensurePermissionsAsync();
  if (status !== 'granted') return;

  const sub = addSmsListener(({ raw, transaction, category }) => {
    if (category !== 'TRANSACTION' || !transaction) return;
    console.log(`${transaction.type} ${transaction.currency} ${transaction.amount}`);
  });

  // …later
  // sub.remove();
}
```

That's it. Every banking SMS now flows through your callback as a typed object.

---

## Complete example

```tsx
import { useEffect, useState } from 'react';
import { Button, FlatList, Text, View } from 'react-native';
import {
  addSmsListener,
  ensurePermissionsAsync,
  formatAmount,
  getRecentMessages,
  openAppSettings,
  summarizeTransactions,
  type ParsedTransaction,
} from 'expo-transaction-sms-reader';

export default function TransactionsScreen() {
  const [txns, setTxns] = useState<ParsedTransaction[]>([]);
  const [permStatus, setPermStatus] = useState<string>('undetermined');

  useEffect(() => {
    let sub: { remove: () => void } | undefined;

    (async () => {
      const status = await ensurePermissionsAsync();
      setPermStatus(status);
      if (status !== 'granted') return;

      // Backfill from the inbox (last 30 days).
      const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
      const initial = await getRecentMessages({
        limit: 200,
        sinceTimestamp: since,
        onlyTransactions: true,
        minConfidence: 0.5,
      });
      setTxns(initial.map((r) => r.transaction!).filter(Boolean));

      // Subscribe to live updates.
      sub = addSmsListener(
        ({ transaction }) => {
          if (transaction && transaction.confidence >= 0.5) {
            setTxns((prev) => [transaction, ...prev]);
          }
        },
        { ignoreOtp: true, minConfidence: 0.5 }
      );
    })();

    return () => sub?.remove();
  }, []);

  const summary = summarizeTransactions(txns);

  if (permStatus === 'blocked') {
    return (
      <View>
        <Text>SMS permission blocked. Please enable it in settings.</Text>
        <Button title="Open settings" onPress={openAppSettings} />
      </View>
    );
  }

  return (
    <View>
      <Text>Net: {formatAmount({ amount: summary.net, currency: 'PKR' })}</Text>
      <Text>Credits: {summary.credit}  ·  Debits: {summary.debit}</Text>

      <FlatList
        data={txns}
        keyExtractor={(t, i) => `${t.timestamp}-${i}`}
        renderItem={({ item }) => (
          <View>
            <Text>{item.type} · {formatAmount(item)} · {item.channel}</Text>
            <Text>{item.bankCode ?? item.sender} · {item.merchant ?? ''}</Text>
          </View>
        )}
      />
    </View>
  );
}
```

---

## API reference

### Permissions

#### `getPermissionStatusAsync()`

```ts
getPermissionStatusAsync(): Promise<SmsPermissionStatus>;
```

Returns the current permission state without prompting:

| Value           | Meaning                                                                |
| --------------- | ---------------------------------------------------------------------- |
| `granted`       | Both `READ_SMS` and `RECEIVE_SMS` are granted.                         |
| `denied`        | Permission is not granted; the prompt can still be shown.              |
| `undetermined`  | The user has never been asked.                                         |
| `blocked`       | The user picked **"Don't ask again"** — only system settings can fix it. |

#### `requestPermissionsAsync()`

```ts
requestPermissionsAsync(): Promise<SmsPermissionStatus>;
```

Prompts the user. Resolves with the resulting status. Returns `'blocked'` when the prompt was previously dismissed with "Don't ask again".

#### `ensurePermissionsAsync()`

```ts
ensurePermissionsAsync(): Promise<SmsPermissionStatus>;
```

Convenience wrapper — checks status, prompts only if not already granted, returns the final state. Use this in 99% of cases.

#### `openAppSettings()`

```ts
openAppSettings(): Promise<void>;
```

Launches the host app's system settings page. Use this when the status is `'blocked'`.

---

### Listening

#### `addSmsListener(callback, options?)`

```ts
addSmsListener(
  callback: (event: SmsReceivedEvent) => void,
  options?: StartListeningOptions
): EventSubscription;
```

Subscribes to live SMS events. Calls the native `startListening` automatically on the first subscription, and `stopListening` automatically when the last subscription is removed (ref-counted).

Each event includes:

- `raw` — the original SMS (`RawSmsMessage`)
- `transaction` — `ParsedTransaction | null`
- `category` — `'TRANSACTION' | 'OTP' | 'PROMOTIONAL' | 'OTHER'`

**Options:**

| Option            | Type            | Default | Effect                                                                                  |
| ----------------- | --------------- | ------- | --------------------------------------------------------------------------------------- |
| `minConfidence`   | `number`        | `0`     | Only emit events whose parsed `confidence ≥` this value.                                |
| `extraKeywords`   | `string[]`      | `[]`    | Extra body keywords that count as a match in addition to built-in heuristics.           |
| `deduplicate`     | `boolean`       | `true`  | Suppress duplicate SMS (same address + body within 5 s).                                |
| `ignoreOtp`       | `boolean`       | `false` | Drop events the classifier flags as OTPs.                                               |
| `senderAllowlist` | `string[]`      | `[]`    | Restrict events to these sender addresses (case-insensitive substring match).           |

#### `startListening(options?)`

```ts
startListening(options?: StartListeningOptions): Promise<void>;
```

Lower-level alternative — explicitly starts the native receiver without registering a JS callback. Useful when delivery is handled by another subsystem (e.g. a foreground service).

#### `stopListening()`

```ts
stopListening(): Promise<void>;
```

Hard-stops the receiver and removes **all** active listeners. Safe to call when not listening.

#### `isListening()`

```ts
isListening(): boolean;
```

Whether the native broadcast receiver is currently registered.

---

### Inbox query

#### `getRecentMessages(options?)`

```ts
getRecentMessages(options?: GetRecentMessagesOptions): Promise<Array<{
  raw: RawSmsMessage;
  transaction: ParsedTransaction | null;
}>>;
```

Reads recent SMS from the system inbox. Throws `SmsPermissionError` when called without `READ_SMS`.

| Option            | Type      | Default | Effect                                                                  |
| ----------------- | --------- | ------- | ----------------------------------------------------------------------- |
| `limit`           | `number`  | `50`    | Max rows. Capped at `500`.                                              |
| `sinceTimestamp`  | `number`  | `0`     | Only return SMS newer than this Unix epoch ms.                          |
| `onlyTransactions`| `boolean` | `false` | Pre-filter at the SQL layer using transaction-indicator keywords.       |
| `senderAllowlist` | `string[]`| `[]`    | Restrict to these sender addresses (case-insensitive substring match).  |
| `minConfidence`   | `number`  | `0`     | Drop rows whose parser confidence is below this.                        |

---

### Parsing

#### `parseTransactionSms(raw)`

```ts
parseTransactionSms(raw: RawSmsMessage): ParsedTransaction | null;
```

Run the built-in heuristic parser on a single SMS. Returns `null` if the message is clearly not a transaction (no indicator keywords AND no detectable amount), or if it's an OTP.

#### `isLikelyTransactionSms(body)`

```ts
isLikelyTransactionSms(body: string): boolean;
```

Fast keyword-only gate. Use as a cheap pre-filter before the full parser.

#### `classifySms(raw)`

```ts
classifySms(raw: RawSmsMessage): SmsCategory;
```

Coarse classification: `'TRANSACTION'` / `'OTP'` / `'PROMOTIONAL'` / `'OTHER'`.

#### `normaliseBankCode(address)`

```ts
normaliseBankCode(address: string): string | null;
```

Maps a sender address (e.g. `VK-HDFCBK`, `JM-JAZZCS-S`) to a stable canonical id (`HDFC`, `JAZZCASH`). Returns `null` when no match — useful as an analytics key since DLT short codes vary by carrier.

---

### OTP detection

#### `isLikelyOtpSms(body)`

```ts
isLikelyOtpSms(body: string): boolean;
```

Returns `true` when the body looks like a 2FA / OTP message.

#### `extractOtp(raw)`

```ts
extractOtp(raw: RawSmsMessage): ParsedOtp | null;
```

Returns the OTP digits, validity window (in seconds), and best-guess sender. Use this to autofill verification screens:

```ts
addSmsListener(({ raw, category }) => {
  if (category !== 'OTP') return;
  const otp = extractOtp(raw);
  if (otp) setVerificationCode(otp.code);
});
```

---

### Aggregation utilities

All operate on plain `ParsedTransaction[]` — no native calls, no permissions.

#### `summarizeTransactions(txns, options?)`

```ts
summarizeTransactions(
  txns: ParsedTransaction[],
  options?: { minConfidence?: number; currency?: string }
): TransactionSummary;
```

Rolls up totals across credits, debits, channels, senders, and currencies. Skips low-confidence and `FAILED` rows.

```ts
const s = summarizeTransactions(txns, { currency: 'PKR' });
console.log(s.net, s.byChannel.UPI.debit, s.bySender.HBL.credit);
```

#### `groupTransactions(txns, keyFn)`

```ts
groupTransactions<K extends string | number>(
  txns: ParsedTransaction[],
  keyFn: (t: ParsedTransaction) => K
): Record<K, ParsedTransaction[]>;
```

Group by any key — sender, channel, day, currency.

```ts
const byDay = groupTransactions(txns, (t) =>
  new Date(t.timestamp).toISOString().slice(0, 10)
);
```

#### `filterByDateRange(txns, from, to)`

```ts
filterByDateRange(txns, from: number, to: number): ParsedTransaction[];
```

Inclusive `[from, to]` range filter. Both are Unix epoch ms.

#### `formatAmount(t, options?)`

```ts
formatAmount(
  t: { amount: number | null; currency: string | null },
  options?: { locale?: string; fallbackCurrency?: string }
): string;
```

Render an amount using `Intl.NumberFormat`. Falls back gracefully on unknown currencies.

#### `signedAmount(t)`

```ts
signedAmount(t: ParsedTransaction): number;
```

Signed delta: positive for `CREDIT`, negative for `DEBIT`, `0` for `UNKNOWN` / `FAILED` / `PENDING`.

---

### Custom parsers

#### `registerParser(parser)`

```ts
registerParser(parser: CustomParser): () => void;
```

Register a parser that runs *before* the built-in one. The first parser to return non-null wins. Returns an unregister function.

```ts
import { registerParser, type CustomParser } from 'expo-transaction-sms-reader';

const handleQuirkyBank: CustomParser = (raw) => {
  if (!raw.address.includes('QUIRKY')) return null;
  const m = /Amt:([0-9.]+)/i.exec(raw.body);
  if (!m) return null;
  return {
    type: 'DEBIT',
    amount: Number(m[1]),
    currency: 'PKR',
    sender: raw.address,
    bankCode: 'QUIRKY',
    account: null,
    balance: null,
    reference: null,
    merchant: null,
    channel: 'BANK_TRANSFER',
    status: 'SUCCESS',
    timestamp: raw.timestamp,
    confidence: 0.9,
    raw,
  };
};

const unregister = registerParser(handleQuirkyBank);
// …
unregister();
```

#### `clearParsers()`

```ts
clearParsers(): void;
```

Removes all registered custom parsers.

---

### Errors

#### `UnsupportedPlatformError`

Thrown by Android-only methods on iOS / web. `instanceof`-checkable.

```ts
import { UnsupportedPlatformError } from 'expo-transaction-sms-reader';

try {
  await startListening();
} catch (e) {
  if (e instanceof UnsupportedPlatformError) {
    // hide the SMS UI on iOS
  }
}
```

#### `SmsPermissionError`

Thrown by `getRecentMessages` when called without `READ_SMS`.

---

## Supported banks & wallets

The sender registry resolves these to canonical `bankCode` values and locks the currency:

| Region         | Banks                                                                                                                                                | Wallets / UPI                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **Pakistan**   | HBL, UBL, MCB, Meezan, Allied (ABL), Askari (AKBL), Faysal, Bank Alfalah (BAFL), Standard Chartered, Habib Metro, Bank Al Habib, Soneri, Summit, Silkbank, NBP, JS Bank, Dubai Islamic Bank, BankIslami | JazzCash, Easypaisa, Sadapay, Nayapay, Konnect, UPaisa                     |
| **India**      | HDFC, ICICI, SBI, Axis, Kotak, Yes Bank, IDFC, RBL, Canara, PNB, Bank of Baroda, Federal, IndusInd, IDBI, Citibank, American Express                  | Paytm, PhonePe, GPay, BHIM, Amazon Pay, Mobikwik, Freecharge               |
| **Bangladesh** | DBBL, BRAC, EBL                                                                                                                                       | bKash, Nagad, Rocket, Upay                                                 |
| **GCC**        | Emirates NBD, ADCB, FAB, Mashreq, RAK Bank · Al Rajhi, Riyad Bank, NCB, Alinma                                                                        | —                                                                          |

Don't see your bank? **Open a PR** adding a row to `SENDER_BANK_REGISTRY` in [`src/parser.ts`](./src/parser.ts) — it's a one-line change plus a sample SMS in the tests.

---

## How the parser works

The parser is a layered heuristic, not a black box. Each layer adds a single piece of structured information:

1. **OTP gate** — `isLikelyOtpSms` short-circuits the whole pipeline. OTPs are never treated as transactions, even when they mention an amount.
2. **Indicator gate** — `isLikelyTransactionSms` checks for transaction-shaped keywords (`debited`, `credited`, `a/c`, `upi`, `imps`, …). Messages that pass *or* contain a detectable amount continue.
3. **Amount detection** — collects every number with a currency prefix/suffix; first currency-tagged amount wins. Falls back to the largest standalone 3+ digit number when no currency token is present.
4. **Type detection** — keyword scoring for CREDIT vs DEBIT, with explicit "credit alert" / "debit alert" headers given extra weight.
5. **Channel detection** — regex sweep for `UPI` / `IMPS` / `NEFT` / `RTGS` / `CARD` / `ATM` / `POS` / `WALLET` / `BANK_TRANSFER` / `CHEQUE` / `ONLINE`. First match wins.
6. **Status detection** — `FAILED` / `PENDING` / `SUCCESS` based on disposition keywords.
7. **Currency disambiguation** — sender registry first (locks "Rs" between PKR / INR), then body tokens.
8. **Field extraction** — account mask, reference id, balance, merchant, bank code.
9. **Confidence scoring** — see below.

You can see the entire pipeline in [`src/parser.ts`](./src/parser.ts) — it's ~500 LOC of pure TypeScript with no external dependencies.

---

## Confidence model

```
confidence  =  0.25 * has_indicator_keywords
            +  0.25 * has_amount
            +  0.15 * type_resolved
            +  0.10 * has_currency
            +  0.10 * has_bank_code
            +  0.08 * has_account_mask
            +  0.07 * has_reference_id
            +  0.05 * has_balance
            +  0.05 * has_channel

  // capped at 0.95 — heuristic, not oracle
  // FAILED   -> capped at 0.70
  // PENDING  -> capped at 0.80
```

| Range       | Meaning                                                       |
| ----------- | ------------------------------------------------------------- |
| `≥ 0.80`    | Almost always correct. Safe to act on without user review.    |
| `0.50–0.80` | Likely correct. Show with a "review" affordance.              |
| `0.40–0.50` | Probably a transaction; some fields may be wrong.             |
| `< 0.40`    | Treat as informational. Often missing amount or type.         |

---

## FAQ & troubleshooting

<details>
<summary><strong>The listener fires but `transaction` is always <code>null</code>.</strong></summary>

Either the SMS doesn't look like a transaction (the classifier returned `OTHER` / `PROMOTIONAL`) or the parser didn't find an amount. Inspect `event.category` and `event.raw.body` to debug, then either:

- add a `CustomParser` for that specific format,
- pass `extraKeywords: ['your-bank-keyword']` to widen the listener gate,
- file an issue with the SMS body so we can extend the built-in heuristics.

</details>

<details>
<summary><strong>I'm getting <code>blocked</code> instead of <code>denied</code>.</strong></summary>

The user picked "Don't ask again" on the system permission prompt. The OS will not show it again. Use `openAppSettings()` to send them to the OS settings page where they can re-grant.

</details>

<details>
<summary><strong>Why is the receiver registered at runtime instead of in the manifest?</strong></summary>

A statically declared `RECEIVE_SMS` receiver triggers Google Play's **default-handler-only** policy review — your app would have to be the user's *default SMS app* to ship. Runtime registration avoids that policy entirely; you still need the SMS-permissions declaration form, but you don't have to be the default messaging app.

</details>

<details>
<summary><strong>Does this work on iOS?</strong></summary>

No, and it can't. iOS does not expose any system-wide API for reading SMS. Every method on iOS resolves to a typed no-op so cross-platform builds don't break.

</details>

<details>
<summary><strong>Will the receiver wake my app from a killed state?</strong></summary>

No. The receiver is registered programmatically when your JS code runs — if the app process is dead, the receiver is gone. If you need background SMS handling across kills, pair this package with a foreground service (out of scope here).

</details>

<details>
<summary><strong>Can I use this in Expo Go?</strong></summary>

No. This is a custom native module — Expo Go doesn't ship it. Use a dev client (`npx expo run:android`) or an EAS build.

</details>

<details>
<summary><strong>EAS build fails with "Unresolved reference 'Coroutine'".</strong></summary>

You're on `0.1.0`. Upgrade to `0.1.1` or later — the import was missing in `0.1.0`. `npm install expo-transaction-sms-reader@latest`.

</details>

---

## Contributing

PRs welcome — especially:

- **More bank / wallet entries** in the sender registry.
- **Sample SMS** for banks the parser handles poorly (open an issue with the body, redact the digits).
- **Locale support** — the parser is South-Asia-tilted; SEA, Africa, LatAm contributions are welcome.
- **Test cases** with real (anonymised) SMS bodies.

```bash
git clone https://github.com/aashir-athar/expo-transaction-sms-reader
cd expo-transaction-sms-reader
npm install
npx tsc --noEmit
```

---

## License

MIT © Aashir Athar — see [LICENSE](./LICENSE).
