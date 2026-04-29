/**
 * Expo Config Plugin for `expo-transaction-sms-reader`.
 *
 * Adds the dangerous SMS permissions to the merged AndroidManifest of any
 * consuming app. Plugin opts in *all* consumers — there is no way to use
 * this module without these permissions, so requiring an extra opt-in step
 * would only confuse first-time users.
 *
 * Usage in `app.json` / `app.config.ts`:
 *
 *   "plugins": ["expo-transaction-sms-reader"]
 *
 * Or with options to gate by build profile:
 *
 *   ["expo-transaction-sms-reader", { "android": { "skip": false } }]
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
    /** Skip permission injection — useful when the host app declares them itself. */
    skip?: boolean;
  };
}

const REQUIRED_PERMISSIONS = [
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_SMS',
];

const withTransactionSmsReader: ConfigPlugin<PluginOptions | void> = (config, options) => {
  const opts = options ?? {};

  if (!opts.android?.skip) {
    config = withAndroidManifest(config, (cfg) => {
      for (const perm of REQUIRED_PERMISSIONS) {
        AndroidConfig.Permissions.ensurePermission(cfg.modResults, perm);
      }
      return cfg;
    });
  }

  return config;
};

export default createRunOncePlugin(withTransactionSmsReader, pkg.name, pkg.version);
