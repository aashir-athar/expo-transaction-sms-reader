<div align="center">

# 🚀 ZERO-TO-DEPLOY

### A maintainer's guide for shipping `expo-transaction-sms-reader` from empty folder → npm.

</div>

This document is the runbook the maintainer (you) uses to take this package from a fresh checkout to a published, version-bumped release on npm — including every step that's easy to miss the first time you build an Expo Module.

> 📌 **Audience:** the package author. End users follow [README.md](./README.md), not this file.

---

## Table of contents

1. [Prerequisites](#1-prerequisites)
2. [Project initialisation (with `create-expo-module`)](#2-project-initialisation-with-create-expo-module)
3. [SDK 54 alignment](#3-sdk-54-alignment)
4. [Local development loop](#4-local-development-loop)
5. [Testing on a real device](#5-testing-on-a-real-device)
6. [Static checks & test suite](#6-static-checks--test-suite)
7. [Versioning strategy](#7-versioning-strategy)
8. [Building for publish](#8-building-for-publish)
9. [Publishing to npm](#9-publishing-to-npm)
10. [Post-release verification](#10-post-release-verification)
11. [Maintenance playbook](#11-maintenance-playbook)
12. [Play Store readiness for consumers](#12-play-store-readiness-for-consumers)
13. [Common pitfalls (and how to escape them)](#13-common-pitfalls-and-how-to-escape-them)

---

## 1. Prerequisites

| Tool                    | Version         | How to verify                       |
|-------------------------|-----------------|-------------------------------------|
| Node.js                 | ≥ 20.x LTS      | `node -v`                           |
| npm                     | ≥ 10.x          | `npm -v`                            |
| Expo CLI                | bundled         | `npx expo --version`                |
| Android Studio          | Hedgehog or newer | Tools → SDK Manager                 |
| JDK                     | 17 (Temurin)    | `java -version`                     |
| Android SDK             | API 34 + 35     | SDK Manager                         |
| An Android device       | API 24+         | enable USB debugging                |
| npm account             | with 2FA        | `npm whoami`                        |

> ✅ **Set `ANDROID_HOME`** and ensure `$ANDROID_HOME/platform-tools` is on your `PATH` so `adb devices` works from any shell.

---

## 2. Project initialisation (with `create-expo-module`)

> Skip this section if you already have the source tree from this repo — it's here so you know how the scaffold was generated and how to recreate it.

```bash
npx create-expo-module@latest expo-transaction-sms-reader \
  --no-example --template module
cd expo-transaction-sms-reader
```

The interactive prompts ask for:

- **Description** → "Real-time banking SMS listener and transaction parser for Expo on Android."
- **GitHub username / repo** → your-org/expo-transaction-sms-reader
- **License** → MIT
- **Author** → your name & email

After scaffolding, replace the generated `src/`, `android/`, `plugin/`, `package.json`, `expo-module.config.json`, `README.md`, and this file with the code from this repository.

---

## 3. SDK 54 alignment

`create-expo-module` follows the latest stable SDK by default, but if you cloned an older scaffold, pin everything to SDK 54 explicitly:

```jsonc
// package.json
{
  "peerDependencies": {
    "expo": "^54.0.0",
    "react": "*",
    "react-native": "*"
  },
  "devDependencies": {
    "expo-module-scripts": "^4.0.0",
    "expo-modules-core": "~2.0.0",
    "@types/react": "~18.3.12"
  }
}
```

```groovy
// android/build.gradle (excerpts)
android {
  compileSdkVersion 35
  defaultConfig {
    minSdkVersion 24
    targetSdkVersion 34
  }
}
```

> 🔍 **React Native version:** SDK 54 ships with **RN 0.81+**. You don't list `react-native` in `dependencies` — it's a peer.

---

## 4. Local development loop

The recommended loop is the bundled **example app** plus Metro hot reload.

```bash
# In the package root
npm install
npm run build         # compiles TS → build/

# In a sibling shell — generate the test app
cd example
npx expo install
npx expo prebuild --clean
npx expo run:android
```

Whenever you edit Kotlin, kill Metro and re-run `expo run:android`. TypeScript edits hot-reload.

> ⚡ **Faster iteration** — keep `npm run build -- --watch` running in a third shell so your `build/` output stays in sync with `src/`.

---

## 5. Testing on a real device

SMS code **cannot be exercised in an emulator** beyond very basic broadcast injection. Use a real Android phone.

1. Plug in via USB, allow USB debugging.
2. Verify with `adb devices`.
3. Inside the example app:
   - Tap **Request** to grant `READ_SMS` + `RECEIVE_SMS`.
   - Tap **Load inbox** to verify content-provider reads.
4. Send the device a real SMS from a second phone. Format suggestions:
   - `Rs. 1,500.00 debited from A/C ****1234. Avbl Bal Rs.45,200. Ref: TXN9823. -HBL`
   - `INR 499.00 spent on HDFC Card xx9921 at AMAZON IN. Avl bal INR 8,210.45.`
5. Confirm the listener fires within ~1 second of arrival.

> 🧪 **Synthetic broadcasts** — for CI and quick smoke tests you can simulate SMS via `adb`:
>
> ```bash
> adb emu sms send +923001234567 "Rs. 100 debited from A/C ****1234. -HBL"
> ```
>
> This works on the standard Android emulator. Hardware devices ignore the command.

---

## 6. Static checks & test suite

```bash
npm run lint           # eslint with expo-module-scripts config
npm run test           # jest
npm run build          # type-check + emit
```

Add unit tests for the parser under `src/__tests__/parser.test.ts`. The parser is pure JS — no native bridge needed for tests:

```ts
import { parseTransactionSms } from '../parser';

test('HBL debit', () => {
  const t = parseTransactionSms({
    id: '1',
    address: 'HBL',
    body: 'Rs. 1,500.00 debited from A/C ****1234. Ref: TXN9823',
    timestamp: Date.now(),
    subscriptionId: null,
  });
  expect(t?.type).toBe('DEBIT');
  expect(t?.amount).toBe(1500);
  expect(t?.currency).toBe('PKR');
  expect(t?.reference).toBe('TXN9823');
});
```

> ✅ **Pre-commit hook** — wire `npm run lint && npm run test` into Husky so failures don't reach `main`.

---

## 7. Versioning strategy

Follow **Semantic Versioning** strictly — consumers depend on `^X.Y.Z`.

| Change kind                                            | Bump   |
|--------------------------------------------------------|--------|
| Bug fix in the parser, no API change                   | patch  |
| New parser, new optional API field, new event payload  | minor  |
| Renamed export, removed method, changed permission set | major  |
| Bump to a new Expo SDK (54 → 55)                       | major  |

Maintain a [Keep-a-Changelog](https://keepachangelog.com/en/1.1.0/) file at `CHANGELOG.md`:

```md
# Changelog
## [Unreleased]
## [0.1.0] - 2026-04-30
### Added
- Initial release: live SMS listener, heuristic parser, inbox query, config plugin.
```

---

## 8. Building for publish

`expo-module-scripts` wraps everything you need:

```bash
npm run clean              # nuke build/ and plugin/build/
npm run build              # tsc for src/ + plugin/
npm run lint
npm run test
```

Verify the **published** tarball has exactly what you expect — no source maps to private paths, no `.env`, no `node_modules`:

```bash
npm pack --dry-run
```

The output should list:

```
build/...                       (compiled JS + .d.ts)
plugin/build/...                (compiled config plugin)
android/...                     (Kotlin sources + manifest + build.gradle)
src/...                         (TS sources for source maps)
app.plugin.js
expo-module.config.json
package.json
README.md
LICENSE
```

If anything sensitive shows up, tighten `files` in `package.json` and `.npmignore`.

---

## 9. Publishing to npm

### First-time publish

```bash
npm login                                # follow the OTP prompt
npm whoami                               # sanity check

# Make absolutely sure the working tree is clean and on main
git status
git pull --ff-only

# Optional but recommended: a final smoke build
npm run prepublishOnly

# Public, scoped or unscoped — this package is unscoped
npm publish --access public --otp=XXXXXX
```

> 🔐 **Always publish with `--otp`** even if you have a session token. Forces a fresh 2FA challenge — non-negotiable for SMS-permission-related packages.

### Subsequent releases

Use `npm version` so the git tag and `package.json` stay in lockstep:

```bash
npm version patch -m "chore(release): %s"
git push --follow-tags
npm publish --access public --otp=XXXXXX
```

`patch` → `minor` → `major` matches the rules in [§7](#7-versioning-strategy).

### Pre-releases

```bash
npm version prerelease --preid=beta -m "chore(release): %s"
# 0.2.0 → 0.2.1-beta.0
npm publish --tag beta --access public --otp=XXXXXX
```

Consumers opt in with `npm install expo-transaction-sms-reader@beta`.

---

## 10. Post-release verification

Within 60 seconds of publish:

1. **Check the npm page** — `https://npmjs.com/package/expo-transaction-sms-reader` should show the new version.
2. **Spin up a clean test app** and `npx expo install expo-transaction-sms-reader@latest`.
3. **Verify the prebuild** — `npx expo prebuild --clean` should succeed and inject the two SMS permissions into `android/app/src/main/AndroidManifest.xml`.
4. **Run on a real device** — confirm the `Quick start` snippet from the README still works end-to-end.
5. **GitHub release notes** — copy the `CHANGELOG.md` entry into a tagged GitHub release.

If any step fails, **deprecate the bad version immediately**:

```bash
npm deprecate expo-transaction-sms-reader@<bad-version> "Critical regression — use <good-version>"
```

…and ship a fixed patch.

---

## 11. Maintenance playbook

| Task                                | Cadence                               |
|-------------------------------------|---------------------------------------|
| Bump Expo SDK target                | Within 30 days of new SDK             |
| Rotate npm 2FA recovery codes       | Every 6 months                        |
| Triage GitHub issues                | Weekly                                |
| Add bank fixture from new PRs       | On merge                              |
| Audit Kotlin for deprecated APIs    | After every Android Studio update     |
| `npm audit` & dependency bumps      | Monthly                               |

**Branching:**

- `main` — always shippable.
- `next` — work for the upcoming SDK rev.
- Feature branches → PR → squash-merge into `main`.

**Release announcement** — pin a GitHub Discussions post for every minor release. Most consumer apps in this niche do not run Dependabot; loud release notes drive upgrade adoption.

---

## 12. Play Store readiness for consumers

You can ship the package, but **consuming apps will be rejected** unless they pass the [Permissions Declaration form](https://support.google.com/googleplay/android-developer/answer/10208820). Add this to your README's launch checklist:

1. Record a screen video showing **why** the app needs SMS access (parsing transactions for the user's own expense ledger, with no data leaving the device).
2. Select the **"Financial features (e.g. budgeting, expense tracking)"** core-functionality category in Play Console.
3. Link to a privacy policy that explicitly states no SMS body is uploaded.
4. Submit; allow **3–10 business days** for review. First submissions are usually rejected once for missing demo footage — re-submit with the requested clip.

Failure to do this means **production rejection on day 1** even though debug builds work fine. Make this a release blocker in your launch checklist.

---

## 13. Common pitfalls (and how to escape them)

<details>
<summary><b>"Module not found: Can't resolve 'expo-transaction-sms-reader'" after publish</b></summary>

Three usual causes:
- The package is missing the `main`/`types` keys → ensure `build/index.js` and `build/index.d.ts` exist.
- The consumer never re-ran `expo prebuild` after install → the autolinking script needs to run.
- The consumer is on Expo Go → cannot work; require a custom dev client.
</details>

<details>
<summary><b>Receiver fires once and then never again</b></summary>

The OEM killed your background process. Either:
- Wrap delivery in a foreground service (out of scope for this package — implement at app level).
- Document the OEM autostart toggle for end users (Xiaomi, Vivo, Oppo, OnePlus all have one).
</details>

<details>
<summary><b><code>npm publish</code> fails with "You do not have permission"</b></summary>

You're either not logged in (`npm whoami`) or the package name is taken. For unscoped names, npm enforces uniqueness across the whole registry — if `expo-transaction-sms-reader` is taken, scope it: `@your-org/expo-transaction-sms-reader`.
</details>

<details>
<summary><b>"This package was sometimes registered" warning on autolinking</b></summary>

Stale `node_modules`. Have the consumer run:

```bash
rm -rf node_modules android/.gradle android/app/build
npx expo prebuild --clean
```
</details>

<details>
<summary><b>Kotlin compile error: "unresolved reference: expo.modules.kotlin"</b></summary>

`expo-modules-core` isn't on the classpath. The `android/build.gradle` already declares it via `implementation project(':expo-modules-core')` — but if you removed that line during edits, autolinking won't substitute it.
</details>

---

<div align="center">

### You're done.

Tag the release, publish the npm version, and update the consumer apps you maintain.

When in doubt — `npm pack --dry-run` first, `npm publish` second.

</div>
