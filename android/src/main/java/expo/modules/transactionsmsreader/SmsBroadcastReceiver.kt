package expo.modules.transactionsmsreader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Log

/**
 * Listens for `android.provider.Telephony.SMS_RECEIVED` and forwards a parsed
 * raw-SMS payload to its [listener]. Multipart messages are concatenated by
 * [Telephony.Sms.Intents.getMessagesFromIntent] before delivery, so the body
 * arrives whole even when the SMS is split across multiple PDUs.
 *
 * The receiver is registered/unregistered programmatically at runtime by
 * [ExpoTransactionSmsReaderModule] — registering in `AndroidManifest.xml`
 * triggers Play Store SMS-permission review and is unnecessary for our needs.
 *
 * Duplicate suppression is intentionally implemented here (same address+body
 * within 5 s) because Android can deliver the same broadcast twice on devices
 * with multiple SIM slots or when telephony services restart.
 */
internal class SmsBroadcastReceiver(
  private val listener: (RawSmsPayload) -> Unit,
  private val deduplicate: Boolean = true
) : BroadcastReceiver() {

  /** Lightweight DTO mirroring the JS-side `RawSmsMessage`. */
  data class RawSmsPayload(
    val id: String? = null,
    val address: String,
    val body: String,
    val timestamp: Long,
    val subscriptionId: Int? = null
  )

  // Bounded ring of recent (address|body, timestampMs) tuples for de-dup.
  private val recent = ArrayDeque<Pair<String, Long>>()
  private val recentLock = Any()
  private val dedupeWindowMs = 5_000L
  private val recentMaxSize = 32

  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    try {
      val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
      if (messages.isEmpty()) return

      // Concatenate all PDUs that share the same originating address. In
      // practice every PDU in a single broadcast comes from the same sender,
      // but we group defensively to handle exotic carriers.
      val grouped = messages.groupBy { it.originatingAddress ?: "" }

      val subscriptionId: Int? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
        intent.getIntExtra("subscription", -1).takeIf { it >= 0 }
      } else null

      for ((address, parts) in grouped) {
        if (address.isEmpty()) continue
        val sortedParts = parts.sortedBy { it.timestampMillis }
        val body = sortedParts.joinToString(separator = "") { it.messageBody.orEmpty() }
        val timestamp = sortedParts.first().timestampMillis

        if (deduplicate && isDuplicate(address, body, timestamp)) continue

        listener(
          RawSmsPayload(
            id = null, // The broadcast doesn't carry a content provider id.
            address = address,
            body = body,
            timestamp = timestamp,
            subscriptionId = subscriptionId
          )
        )
      }
    } catch (t: Throwable) {
      // Never let an exception propagate from a BroadcastReceiver — Android
      // will kill the hosting process if we do.
      Log.e(TAG, "Failed to dispatch SMS broadcast", t)
    }
  }

  private fun isDuplicate(address: String, body: String, ts: Long): Boolean {
    val key = "$address|${body.hashCode()}"
    synchronized(recentLock) {
      // Drop entries older than the dedupe window.
      while (recent.isNotEmpty() && ts - recent.first().second > dedupeWindowMs) {
        recent.removeFirst()
      }
      val seen = recent.any { it.first == key && (ts - it.second) <= dedupeWindowMs }
      if (!seen) {
        if (recent.size >= recentMaxSize) recent.removeFirst()
        recent.addLast(key to ts)
      }
      return seen
    }
  }

  companion object {
    private const val TAG = "ExpoTxnSmsReader"
  }
}
