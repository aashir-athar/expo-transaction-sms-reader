<div align="center">

# 📩💸 expo-transaction-sms-reader

### Real-time **banking & wallet SMS** intelligence for Expo SDK 54 — Android-only.

[![npm](https://img.shields.io/npm/v/expo-transaction-sms-reader.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/expo-transaction-sms-reader)
[![npm downloads](https://img.shields.io/npm/dm/expo-transaction-sms-reader.svg?style=flat-square&color=cb3837)](https://www.npmjs.com/package/expo-transaction-sms-reader)
[![Expo SDK](https://img.shields.io/badge/Expo%20SDK-54-000020.svg?style=flat-square&logo=expo&logoColor=white)](https://docs.expo.dev/versions/v54.0.0/)
[![Platform](https://img.shields.io/badge/platform-Android-3DDC84.svg?style=flat-square&logo=android&logoColor=white)](#-platform-support)
[![License](https://img.shields.io/npm/l/expo-transaction-sms-reader.svg?style=flat-square&color=blue)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg?style=flat-square&logo=typescript&logoColor=white)](#)

Listen to incoming SMS in real-time, intelligently parse **banking, mobile-wallet, UPI and credit-card** notifications, and surface clean, typed transaction objects — built for **fintech, budgeting, and expense-tracking** apps in **Pakistan, India, Bangladesh** and beyond.

</div>

---

## ✨ Features

- 📡 **Live SMS listening** — runtime-registered `BroadcastReceiver` for `SMS_RECEIVED`, no Play Store policy review headaches.
- 🧠 **Heuristic transaction parser** — extracts type, amount, currency, sender, account mask, reference, balance, merchant, and a confidence score.
- 🇵🇰🇮🇳🇧🇩 **Tuned for South-Asian banks & wallets** — HBL, UBL, MCB, Meezan, JazzCash, Easypaisa, SadaPay, NayaPay, HDFC, ICICI, SBI, Paytm, PhonePe, GPay, bKash, Nagad, …
- 🧩 **Pluggable parsers** — register bank-specific overrides without rebuilding the native module.
- 📜 **Inbox query** — pull historical SMS via the system content provider, with optional transaction-only filtering.
- 🔐 **Permission helpers** — first-class `requestPermissionsAsync` + `getPermissionStatusAsync`.
- 🛡️ **Privacy-conscious** — nothing is persisted by the module; all parsing happens locally.
- 🧱 **Pure Expo Modules API** — Kotlin native side, fully typed TS surface, ships a Config Plugin.
- 🪶 **Tiny footprint** — no extra runtime dependencies; coroutines for off-main-thread inbox reads.

---

## 📱 Platform support

| Platform | Status                                                    |
|----------|-----------------------------------------------------------|
| Android  | ✅ Fully supported                                         |
| iOS      | ❌ **Not supported** — Apple does not allow SMS reading    |
| Web      | ❌ Not supported (no SMS APIs)                             |

> **iOS is intentionally a no-op stub.** The package can still be imported on iOS builds — every method either resolves to a sane default or throws `UnsupportedPlatformError`. See [Platform safety](#-platform-safety).

---

## 📦 Installation

```bash
npx expo install expo-transaction-sms-reader
```

Then prebuild & rebuild the native project — this package needs a custom dev client (it cannot run in Expo Go because Go does not ship native SMS code).

```bash
npx expo prebuild --clean
npx expo run:android
```

> **Working with EAS?** Add the package, commit, and the next `eas build --profile development --platform android` will pick it up automatically.

---

## ⚙️ Configuration

Add the Config Plugin to your `app.json` / `app.config.ts`. It injects the required Android permissions (`READ_SMS`, `RECEIVE_SMS`) into the merged manifest.

```json
{
  "expo": {
    "plugins": ["expo-transaction-sms-reader"]
  }
}
```

If your app already declares the permissions itself, opt out:

```json
{
  "expo": {
    "plugins": [
      ["expo-transaction-sms-reader", { "android": { "skip": true } }]
    ]
  }
}
```

> ⚠️ **Google Play policy.** Apps requesting `READ_SMS` / `RECEIVE_SMS` must complete the [Permissions Declaration](https://support.google.com/googleplay/android-developer/answer/10208820) and qualify for an approved use case (e.g. "Financial features"). Expense trackers and personal-finance apps using on-device parsing typically qualify — third-party banks and OTP autofill do not. Plan for this *before* you publish.

---

## 🚀 Quick start

```tsx
import {
  requestPermissionsAsync,
  addSmsListener,
} from 'expo-transaction-sms-reader';

await requestPermissionsAsync();

const sub = addSmsListener(({ raw, transaction }) => {
  if (transaction?.confidence ?? 0 >= 0.6) {
    console.log(`${transaction!.type} ${transaction!.currency} ${transaction!.amount}`);
  }
});

// later — clean up
sub.remove();
```

That's it. The native receiver is started lazily on the first listener and torn down when the last subscription is removed.

---

## 📚 API reference

### Permissions

#### `getPermissionStatusAsync(): Promise<SmsPermissionStatus>`

Returns `'granted' | 'denied' | 'undetermined'`. Resolves to `'denied'` on iOS / web.

#### `requestPermissionsAsync(): Promise<SmsPermissionStatus>`

Prompts the user for `READ_SMS` + `RECEIVE_SMS`. After a "Don't ask again" denial the prompt is suppressed by Android — direct the user to system settings in that case.

---

### Listening

#### `addSmsListener(callback, options?): EventSubscription`

Subscribe to live SMS events. The native receiver starts on the first listener.

```ts
const sub = addSmsListener(
  ({ raw, transaction }) => { /* … */ },
  {
    minConfidence: 0.5,        // drop low-confidence parses
    deduplicate: true,         // suppress same-address+body within 5s (default: true)
    extraKeywords: ['promo'],  // also emit on these hits (default: [])
  }
);

sub.remove();
```

#### `startListening(options?) / stopListening() / isListening()`

Lower-level, callback-less control over the native receiver. Useful when delivery is handled elsewhere (e.g. a foreground service).

---

### Inbox query

#### `getRecentMessages(options?): Promise<{ raw, transaction }[]>`

Reads from the system SMS content provider. Requires `READ_SMS`.

```ts
const rows = await getRecentMessages({
  limit: 100,             // capped at 500
  sinceTimestamp: 0,      // Unix epoch ms; 0 = no lower bound
  onlyTransactions: true, // pre-filter at the SQL layer
});
```

Each row pairs the raw SMS with a `ParsedTransaction | null`. Sorted newest first.

---

### Custom parsers

Run *before* the built-in heuristic parser. The first to return a non-null result wins.

```ts
import { registerParser, parseTransactionSms } from 'expo-transaction-sms-reader';

const unregister = registerParser((raw) => {
  if (!raw.address.includes('MEEZAN')) return null;
  const parsed = parseTransactionSms(raw);
  if (!parsed) return null;
  return { ...parsed, sender: 'Meezan Bank', confidence: 0.95 };
});

// later
unregister();
```

Custom parsers must never throw — exceptions are caught and the parser is skipped.

You can also call `parseTransactionSms(raw)` and `isLikelyTransactionSms(body)` standalone — handy for unit tests or batch-processing exported message dumps.

---

### Types

```ts
type TransactionType = 'CREDIT' | 'DEBIT' | 'UNKNOWN';

interface RawSmsMessage {
  id: string | null;
  address: string;
  body: string;
  timestamp: number;        // Unix epoch ms
  subscriptionId: number | null;
}

interface ParsedTransaction {
  type: TransactionType;
  amount: number | null;
  currency: string | null;  // PKR, INR, BDT, USD, …
  sender: string;
  account: string | null;   // e.g. "****1234"
  balance: number | null;
  reference: string | null; // TXN id / RRN / UTR / UPI ref
  merchant: string | null;
  timestamp: number;
  confidence: number;       // [0, 1]
  raw: RawSmsMessage;
}
```

Full surface is exported from the package root — `import type { … } from 'expo-transaction-sms-reader'`.

---

## 🧪 Example output

| SMS body                                                                                        | Parsed                                                              |
|-------------------------------------------------------------------------------------------------|---------------------------------------------------------------------|
| `Rs. 1,500.00 debited from A/C ****1234 on 12-Jan. Avbl Bal Rs.45,200. Ref: TXN98237. -HBL`     | `DEBIT · PKR 1500.00 · ****1234 · ref TXN98237 · bal 45200 · 0.85`  |
| `Credit Alert: PKR 25,000.00 received in your JazzCash wallet. TID: JC8721KQ`                   | `CREDIT · PKR 25000.00 · ref JC8721KQ · 0.80`                       |
| `INR 499.00 spent on HDFC Card xx9921 at AMAZON IN. Avl bal INR 8,210.45. Ref 401923`           | `DEBIT · INR 499.00 · xx9921 · merchant AMAZON IN · ref 401923 · 0.90` |
| `OTP 824931 valid 5 mins. Do not share.`                                                        | `null` (not a transaction)                                          |

---

## 🧷 Platform safety

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

Wrap your usage in `Platform.OS === 'android'` checks for cross-platform builds.

---

## 🛠 Troubleshooting

<details>
<summary><b>Permission keeps resolving to <code>'denied'</code> even after granting it</b></summary>

The user likely tapped **"Don't ask again"** on a previous denial. Android suppresses subsequent prompts. Direct them to system settings:

```ts
import { Linking } from 'react-native';
import * as IntentLauncher from 'expo-intent-launcher';

await IntentLauncher.startActivityAsync('android.settings.APPLICATION_DETAILS_SETTINGS', {
  data: 'package:' + (await Application.applicationIdAsync),
});
```
</details>

<details>
<summary><b>No events firing in production</b></summary>

Most commonly:
1. **Battery optimization** is killing your background process. Ask users to whitelist your app via `IGNORE_BATTERY_OPTIMIZATIONS` (or wrap the receiver in a foreground service for guaranteed delivery).
2. The receiver was started without `READ_SMS` granted — check `getPermissionStatusAsync()` first.
3. The OEM (Xiaomi, Oppo, Vivo) requires manual "Autostart" permission — there is no programmatic way to grant this; document it for end users.
</details>

<details>
<summary><b>Duplicate events for the same SMS</b></summary>

Already handled — the receiver de-duplicates by `(address, body)` within a 5-second window. If you're still seeing dupes, ensure you only call `addSmsListener` once (or set `deduplicate: true` explicitly).
</details>

<details>
<summary><b>Parser returns the wrong amount for my bank</b></summary>

Register a custom parser:

```ts
import { registerParser, parseTransactionSms } from 'expo-transaction-sms-reader';

registerParser((raw) => {
  if (raw.address !== 'MY-BANK') return null;
  // your override
  return { ...parseTransactionSms(raw)!, amount: yourCustomAmount };
});
```

Then please open a PR with a test fixture so we can improve the default heuristics for everyone. 🙏
</details>

<details>
<summary><b>Play Store rejection: "Use of restricted permissions"</b></summary>

You must complete the [Permissions Declaration](https://support.google.com/googleplay/android-developer/answer/10208820) and select an approved use case. For SMS-based budgeting apps, the canonical declaration is **"Financial features that require SMS access to function"** with a video demo showing the in-app expense tracking. Allow 1–2 weeks for review.
</details>

---

## 🤝 Contributing

PRs welcome! In particular:

- **Bank fixtures** — drop your country's SMS samples (with PII redacted) into `__tests__/fixtures/`.
- **New currencies** — extend `CURRENCY_MAP` in [src/parser.ts](./src/parser.ts).
- **Custom-parser presets** — bundled overrides for popular banks would be great.

Run the test suite:

```bash
npm install
npm run test
npm run lint
```

---

## 📄 License

[MIT](./LICENSE) © 2026 expo-transaction-sms-reader contributors

---

<div align="center">
<sub>Built with ❤️ for fintech builders in <b>Pakistan 🇵🇰, India 🇮🇳, Bangladesh 🇧🇩</b> and beyond.</sub>
</div>
