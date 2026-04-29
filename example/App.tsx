/**
 * Minimal example consumer for `expo-transaction-sms-reader`.
 *
 * Run via:
 *   cd example && npx expo prebuild --clean && npx expo run:android
 *
 * This file lives outside the published `files` glob — it ships with the
 * GitHub repo only, not with the npm tarball.
 */

import {
  addSmsListener,
  getPermissionStatusAsync,
  getRecentMessages,
  parseTransactionSms,
  registerParser,
  requestPermissionsAsync,
  type ParsedTransaction,
  type SmsReceivedEvent,
} from 'expo-transaction-sms-reader';
import { useEffect, useState } from 'react';
import { Button, FlatList, SafeAreaView, Text, View } from 'react-native';

export default function App() {
  const [status, setStatus] = useState<string>('unknown');
  const [transactions, setTransactions] = useState<ParsedTransaction[]>([]);

  useEffect(() => {
    getPermissionStatusAsync().then(setStatus);

    // Bank-specific override: HBL Pakistan uses a unique "TXN ID" prefix that
    // the default heuristic over-greedy-matches. Demonstrates `registerParser`.
    const unregister = registerParser((raw) => {
      if (!raw.address.toUpperCase().includes('HBL')) return null;
      const parsed = parseTransactionSms(raw);
      if (!parsed) return null;
      return { ...parsed, sender: 'HBL Pakistan', confidence: Math.min(0.99, parsed.confidence + 0.05) };
    });

    return unregister;
  }, []);

  useEffect(() => {
    if (status !== 'granted') return;

    const sub = addSmsListener((event: SmsReceivedEvent) => {
      if (event.transaction && event.transaction.confidence >= 0.5) {
        setTransactions((prev) => [event.transaction!, ...prev].slice(0, 50));
      }
    }, { minConfidence: 0.4 });

    return () => sub.remove();
  }, [status]);

  return (
    <SafeAreaView style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>
        Permission: {status}
      </Text>
      <View style={{ flexDirection: 'row', gap: 8, marginVertical: 12 }}>
        <Button title="Request" onPress={async () => setStatus(await requestPermissionsAsync())} />
        <Button title="Load inbox" onPress={async () => {
          const rows = await getRecentMessages({ limit: 100, onlyTransactions: true });
          setTransactions(rows.flatMap((r) => (r.transaction ? [r.transaction] : [])));
        }} />
      </View>
      <FlatList
        data={transactions}
        keyExtractor={(t, i) => `${t.timestamp}-${i}`}
        renderItem={({ item }) => (
          <View style={{ paddingVertical: 8, borderBottomWidth: 1, borderColor: '#eee' }}>
            <Text style={{ fontWeight: '600' }}>
              {item.type} · {item.currency ?? '?'} {item.amount?.toFixed(2) ?? '?'}
            </Text>
            <Text>{item.sender} → {item.merchant ?? '—'}</Text>
            <Text style={{ color: '#888' }}>conf {item.confidence.toFixed(2)} · {item.reference ?? 'no ref'}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}
