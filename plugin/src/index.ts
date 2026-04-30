/**
 * Expo Config Plugin for `expo-transaction-sms-reader`.
 *
 * Adds the dangerous SMS permissions to the merged `AndroidManifest.xml` of
 * any consuming app. Plugin opts in *all* consumers by default — there is no
 * way to use the live receiver without these permissions. Callers that only
 * want to *parse* SMS strings (without reading the inbox) can opt out via
 * `permissions: { read: false, receive: false }`.
 *
 * Usage in `app.json` / `app.config.ts`:
 *
 *   "plugins": ["expo-transaction-sms-reader"]
 *
 * Or with options:
 *
 *   ["expo-transaction-sms-reader", {
 *     "android": {
 *       "permissions": { "read": true, "receive": true }
 *     }
 *   }]
 *
 * To skip permission injection entirely (e.g. host app declares them itself):
 *
 *   ["expo-transaction-sms-reader", { "android": { "skip": true } }]
 */

import {
  AndroidConfig,
  ConfigPlugin,
  createRunOncePlugin,
  withAndroidManifest,
} from 'expo/config-plugins';

const pkg = require('../../package.json') as { name: string; version: string };

interface PluginOptions {
  android?: {
    /** Skip *all* permission injection. Useful when the host app declares them itself. */
    skip?: boolean;
    /** Fine-grained control over which permissions to inject. Both default to `true`. */
    permissions?: {
      read?: boolean;
      receive?: boolean;
    };
  };
}

const READ_SMS = 'android.permission.READ_SMS';
const RECEIVE_SMS = 'android.permission.RECEIVE_SMS';

const withTransactionSmsReader: ConfigPlugin<PluginOptions | void> = (config, options) => {
  const opts = options ?? {};
  if (opts.android?.skip) return config;

  const wantRead = opts.android?.permissions?.read ?? true;
  const wantReceive = opts.android?.permissions?.receive ?? true;
  if (!wantRead && !wantReceive) return config;

  return withAndroidManifest(config, (cfg) => {
    if (wantRead) AndroidConfig.Permissions.ensurePermission(cfg.modResults, READ_SMS);
    if (wantReceive) AndroidConfig.Permissions.ensurePermission(cfg.modResults, RECEIVE_SMS);
    return cfg;
  });
};

export default createRunOncePlugin(withTransactionSmsReader, pkg.name, pkg.version);
