<div align="center">

# 📲 expo-transaction-sms-reader

**Android-only Expo SDK 54 module to read & parse banking and wallet transaction SMS in real time — classify OTP vs transaction, extract OTPs, and return clean, fully-typed React Native fintech data.**

[![npm version](https://img.shields.io/npm/v/expo-transaction-sms-reader?style=for-the-badge&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/expo-transaction-sms-reader)
[![Stars](https://img.shields.io/github/stars/aashir-athar/expo-transaction-sms-reader?style=for-the-badge&logo=github&color=FFD33D)](https://github.com/aashir-athar/expo-transaction-sms-reader/stargazers)
[![License](https://img.shields.io/github/license/aashir-athar/expo-transaction-sms-reader?style=for-the-badge&color=blue)](./LICENSE)
[![Last commit](https://img.shields.io/github/last-commit/aashir-athar/expo-transaction-sms-reader?style=for-the-badge)](https://github.com/aashir-athar/expo-transaction-sms-reader/commits)
[![Top language](https://img.shields.io/github/languages/top/aashir-athar/expo-transaction-sms-reader?style=for-the-badge)](https://github.com/aashir-athar/expo-transaction-sms-reader)

[![Expo SDK 54](https://img.shields.io/badge/Expo_SDK-54-000020?style=flat-square&logo=expo&logoColor=white)](https://docs.expo.dev/versions/v54.0.0/)
[![Platform Android](https://img.shields.io/badge/platform-Android-3DDC84?style=flat-square&logo=android&logoColor=white)](#-platform-support)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?style=flat-square&logo=typescript&logoColor=white)](#)
[![Kotlin](https://img.shields.io/badge/Kotlin-native-7F52FF?style=flat-square&logo=kotlin&logoColor=white)](#)
[![npm downloads](https://img.shields.io/npm/dm/expo-transaction-sms-reader?style=flat-square&logo=npm&logoColor=white&color=cb3837)](https://www.npmjs.com/package/expo-transaction-sms-reader)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen?style=flat-square)](#-contributing)

<a href="https://www.npmjs.com/package/expo-transaction-sms-reader"><strong>npm Package</strong></a> ·
<a href="#-getting-started"><strong>Getting Started</strong></a> ·
<a href="#-usage"><strong>Usage</strong></a> ·
<a href="https://github.com/aashir-athar/expo-transaction-sms-reader/issues"><strong>Report Bug</strong></a> ·
<a href="https://github.com/aashir-athar/expo-transaction-sms-reader/issues"><strong>Request Feature</strong></a>

</div>

---

**expo-transaction-sms-reader** is an Android-only [Expo](https://docs.expo.dev/) SDK 54 native module that reads incoming **banking and mobile-wallet SMS** in real time, classifies each message, and parses transaction alerts into clean, typed objects. It turns raw bank SMS — UPI, IMPS, NEFT, RTGS, ATM, POS, card and wallet notifications — into structured `ParsedTransaction` data, extracts OTPs for autofill, and recognises 60+ South-Asian, Indian, Bangladeshi and GCC institutions. Built for **fintech, budgeting, expense-tracking and digital-wallet** React Native apps.

```text
SMS arrives ─► BroadcastReceiver ─► Classifier ─► Parser ─► Typed Transaction ─► Your UI
                                        │            │
                                        │            └─ DEBIT · PKR 1,500.00 · UPI · ****1234 · ref TXN9823 · 0.95
                                        │
                                        └─ TRANSACTION / OTP / PROMOTIONAL / OTHER
```

> 📦 Published on npm as [`expo-transaction-sms-reader`](https://www.npmjs.com/package/expo-transaction-sms-reader). Pure-TypeScript parser + Kotlin runtime receiver — re-run the parser on any SMS string without rebuilding native code.

## Table of Contents

- [Features](#-features)
- [Platform Support](#-platform-support)
- [Tech Stack](#-tech-stack)
- [Getting Started](#-getting-started)
- [Usage](#-usage)
- [API Overview](#-api-overview)
- [Roadmap](#️-roadmap)
- [Contributing](#-contributing)
- [License](#-license)
- [Author](#-author)

## ✨ Features

| | Feature | Description |
|---|---|---|
| 📡 | **Live SMS listener** | Runtime-registered `BroadcastReceiver` — no manifest-declared receivers, so no separate Play Store default-handler review. |
| 📥 | **Inbox query** | Read recent SMS from the system content provider with date / keyword / sender / confidence filters. |
| 🧠 | **Smart classifier** | Every SMS is bucketed into `TRANSACTION`, `OTP`, `PROMOTIONAL`, or `OTHER`. |
| 🔐 | **OTP extraction** | Pull OTP digits out for autofill, with validity-window detection. |
| 💸 | **Heuristic parser** | Covers UPI, IMPS, NEFT, RTGS, ATM, POS, cards, wallets, cheques and online payments. |
| 🏦 | **60+ banks & wallets** | Recognises South-Asian, Indian, Bangladeshi and GCC institutions. |
| 🔀 | **Channel & status detection** | Resolves `UPI` / `IMPS` / `NEFT` / `RTGS` / `CARD` / `ATM` / `POS` / `WALLET` and `SUCCESS` / `PENDING` / `FAILED` / `UNKNOWN`. |
| 💱 | **Currency disambiguation** | Sender registry resolves "Rs" between PKR / INR / LKR / NPR. |
| 📊 | **Aggregation utilities** | `summarizeTransactions`, `groupTransactions`, `filterByDateRange`, `formatAmount`, `signedAmount`. |
| 🧩 | **Custom parsers** | Register your own first-pass parser for bank-specific formats. |
| 🔁 | **Ref-counted listener** | Multiple `addSmsListener` calls share one native receiver; it detaches on the last unsubscribe. |
| 🛟 | **Safe iOS / web stubs** | Every method becomes a typed no-op so you can build cross-platform without conditionals. |
| 🦺 | **Strict TypeScript** | Fully typed: `ParsedTransaction`, `RawSmsMessage`, `SmsCategory`, `TransactionChannel`, `TransactionStatus`, and more. |

## 📱 Platform Support

| Platform | Status |
|---|---|
| **Android 7+** | Full support (SDK 24+, tested on SDK 26 / 33 / 34 / 35). |
| iOS | No-op stub — methods return sane defaults / throw `UnsupportedPlatformError` where relevant. |
| Web | Same no-op stub. |

> iOS *cannot* read SMS by design — Apple exposes no system-wide API for it. This is a hardware/OS limitation, not a planned feature.

## 🛠️ Tech Stack

![Expo](https://img.shields.io/badge/Expo-000020?style=for-the-badge&logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)
![Kotlin](https://img.shields.io/badge/Kotlin-7F52FF?style=for-the-badge&logo=kotlin&logoColor=white)
![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white)

Built with the **Expo Modules API** (TypeScript surface + Kotlin native implementation) and a config plugin that injects the required `READ_SMS` / `RECEIVE_SMS` permissions into your `AndroidManifest.xml`.

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18
- An Expo SDK 54 project with the New Architecture (default since SDK 51)
- A **dev client** — this is a native module, so it does not run in Expo Go
- An Android 7+ device or emulator

### Installation

```bash
npx expo install expo-transaction-sms-reader
```

Or with your package manager of choice:

```bash
npm  install expo-transaction-sms-reader
yarn add     expo-transaction-sms-reader
pnpm add     expo-transaction-sms-reader
```

### Configure the plugin

Register the config plugin in `app.json` / `app.config.ts` to inject the SMS permissions:

```json
{
  "expo": {
    "plugins": ["expo-transaction-sms-reader"]
  }
}
```

### Build & run

```bash
npx expo prebuild
npx expo run:android
```

<details>
<summary><strong>Advanced plugin options</strong></summary>

```jsonc
{
  "plugins": [
    ["expo-transaction-sms-reader", {
      "android": {
        // Skip injecting BOTH permissions (host app declares them itself).
        "skip": false,
        // Or fine-grained — toggle each permission.
        "permissions": { "read": true, "receive": true }
      }
    }]
  ]
}
```

| Option | Default | Effect |
|---|---|---|
| `android.skip` | `false` | Skip injecting both permissions. |
| `android.permissions.read` | `true` | Inject `READ_SMS` (inbox query). |
| `android.permissions.receive` | `true` | Inject `RECEIVE_SMS` (live listener). |

> **Play Store policy:** apps requesting `READ_SMS` / `RECEIVE_SMS` must comply with Google's [SMS / Call Log Permissions Policy](https://support.google.com/googleplay/android-developer/answer/10208820). Expect a permissions-declaration form during review.

</details>

## 📖 Usage

Request permission, then subscribe to live transactions:

```ts
import {
  ensurePermissionsAsync,
  addSmsListener,
} from 'expo-transaction-sms-reader';

async function start() {
  const status = await ensurePermissionsAsync();
  if (status !== 'granted') return;

  const sub = addSmsListener(({ transaction, category }) => {
    if (category !== 'TRANSACTION' || !transaction) return;
    console.log(`${transaction.type} ${transaction.currency} ${transaction.amount}`);
  });

  // …later
  // sub.remove();
}
```

Every banking SMS now flows through your callback as a typed `ParsedTransaction`. For example, the message:

> `Rs. 1,500.00 debited from a/c xx1234 via UPI/HDFCBK; UPI Ref 412345678; Avbl Bal: Rs. 23,450.00`

is parsed into:

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

<details>
<summary><strong>Backfill from the inbox + live updates (React component)</strong></summary>

```tsx
import { useEffect, useState } from 'react';
import {
  addSmsListener,
  ensurePermissionsAsync,
  getRecentMessages,
  summarizeTransactions,
  type ParsedTransaction,
} from 'expo-transaction-sms-reader';

export function useTransactions() {
  const [txns, setTxns] = useState<ParsedTransaction[]>([]);

  useEffect(() => {
    let sub: { remove: () => void } | undefined;

    (async () => {
      if ((await ensurePermissionsAsync()) !== 'granted') return;

      // Backfill the last 30 days from the inbox.
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

  return summarizeTransactions(txns);
}
```

</details>

## 🧰 API Overview

| Area | Functions |
|---|---|
| **Permissions** | `getPermissionStatusAsync`, `requestPermissionsAsync`, `ensurePermissionsAsync`, `openAppSettings` |
| **Listening** | `addSmsListener`, `startListening`, `stopListening`, `isListening` |
| **Inbox** | `getRecentMessages` |
| **Parsing** | `registerCustomParser` (+ re-run the pure-TS parser on any SMS string) |
| **Aggregation** | `summarizeTransactions`, `groupTransactions`, `filterByDateRange`, `formatAmount`, `signedAmount` |

`addSmsListener` is ref-counted: the native receiver starts on the first subscription and stops automatically when the last one is removed. Options include `minConfidence`, `extraKeywords`, `deduplicate`, `ignoreOtp` and `senderAllowlist`.

> A runnable example app lives in [`example/App.tsx`](./example/App.tsx).

## 🗺️ Roadmap

- [x] Real-time runtime SMS listener (ref-counted)
- [x] Heuristic transaction parser (UPI / IMPS / NEFT / RTGS / ATM / POS / cards / wallets)
- [x] SMS classifier (`TRANSACTION` / `OTP` / `PROMOTIONAL` / `OTHER`)
- [x] OTP extraction + currency disambiguation
- [x] Inbox query + aggregation utilities
- [x] Config plugin for permission injection
- [ ] Expanded bank/wallet registry coverage
- [ ] Optional foreground-service delivery recipe
- [ ] Community-contributed custom parser presets

> 🚧 **Active development** — the API is stable but evolving. Pin a version and check the changelog before upgrading.

## 🤝 Contributing

Contributions are welcome. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the repo
2. Create a branch (`git checkout -b feat/your-feature`)
3. Build and lint (`npm run build && npm run lint`)
4. Commit, push, and open a Pull Request

## 📄 License

Distributed under the **MIT** License. See [LICENSE](./LICENSE) for details.

## 👤 Author

**Aashir Athar**

[![GitHub](https://img.shields.io/badge/GitHub-aashir--athar-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/aashir-athar)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-aashirathar-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/aashirathar/)
[![X](https://img.shields.io/badge/X_(Twitter)-aashirathar-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/aashirathar)

---

<div align="center">

<sub>Built by <a href="https://github.com/aashir-athar">aashir-athar</a> · If this helped you ship faster, consider leaving a ⭐</sub>

<br /><br />

<sub><b>Keywords:</b> expo sms reader · react native sms parser · android transaction sms · bank sms parser · upi sms · otp extraction · fintech expense tracker · expo sdk 54 module · kotlin broadcast receiver · personal finance</sub>

</div>
