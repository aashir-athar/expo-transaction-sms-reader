package expo.modules.transactionsmsreader

import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.Telephony
import android.util.Log

/**
 * Reads recent SMS from the system content provider. All work happens
 * synchronously on the calling coroutine — [ExpoTransactionSmsReaderModule]
 * dispatches it to the IO dispatcher.
 */
internal object SmsInboxReader {

  private const val TAG = "ExpoTxnSmsReader"

  // We deliberately exclude the `address` column from the selection so we can
  // match it case-insensitively in Kotlin — vendor SQLite builds vary on
  // collation support, and "ICICIBANK" vs "icicibank" must both match.
  private val PROJECTION = arrayOf(
    Telephony.Sms.Inbox._ID,
    Telephony.Sms.Inbox.ADDRESS,
    Telephony.Sms.Inbox.BODY,
    Telephony.Sms.Inbox.DATE,
    Telephony.Sms.Inbox.SUBSCRIPTION_ID
  )

  fun query(
    context: Context,
    limit: Int,
    sinceTimestamp: Long,
    onlyTransactionsHint: List<String>
  ): List<SmsBroadcastReceiver.RawSmsPayload> {
    val results = ArrayList<SmsBroadcastReceiver.RawSmsPayload>(limit.coerceAtMost(64))

    val selection = StringBuilder()
    val selectionArgs = ArrayList<String>()
    if (sinceTimestamp > 0) {
      selection.append(Telephony.Sms.Inbox.DATE).append(" > ?")
      selectionArgs.add(sinceTimestamp.toString())
    }

    // We over-fetch by a small factor when filtering by keyword so we still
    // return `limit` matching rows after post-filtering.
    val sqlLimit = if (onlyTransactionsHint.isNotEmpty()) (limit * 4).coerceAtMost(2000) else limit
    val sortOrder = "${Telephony.Sms.Inbox.DATE} DESC LIMIT $sqlLimit"

    val cursor: Cursor? = try {
      context.contentResolver.query(
        Telephony.Sms.Inbox.CONTENT_URI,
        PROJECTION,
        if (selection.isEmpty()) null else selection.toString(),
        if (selectionArgs.isEmpty()) null else selectionArgs.toTypedArray(),
        sortOrder
      )
    } catch (e: SecurityException) {
      Log.w(TAG, "READ_SMS not granted — cannot query inbox.", e)
      null
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to query SMS inbox", t)
      null
    }

    cursor?.use { c ->
      val idIdx = c.getColumnIndex(Telephony.Sms.Inbox._ID)
      val addrIdx = c.getColumnIndex(Telephony.Sms.Inbox.ADDRESS)
      val bodyIdx = c.getColumnIndex(Telephony.Sms.Inbox.BODY)
      val dateIdx = c.getColumnIndex(Telephony.Sms.Inbox.DATE)
      val subIdx = c.getColumnIndex(Telephony.Sms.Inbox.SUBSCRIPTION_ID)

      while (c.moveToNext() && results.size < limit) {
        val body = if (bodyIdx >= 0) c.getString(bodyIdx).orEmpty() else ""
        if (body.isEmpty()) continue
        if (onlyTransactionsHint.isNotEmpty() && !matchesAny(body, onlyTransactionsHint)) continue

        results.add(
          SmsBroadcastReceiver.RawSmsPayload(
            id = if (idIdx >= 0) c.getString(idIdx) else null,
            address = if (addrIdx >= 0) c.getString(addrIdx).orEmpty() else "",
            body = body,
            timestamp = if (dateIdx >= 0) c.getLong(dateIdx) else 0L,
            subscriptionId = if (subIdx >= 0) {
              val s = c.getInt(subIdx)
              if (s >= 0) s else null
            } else null
          )
        )
      }
    }

    return results
  }

  private fun matchesAny(body: String, keywords: List<String>): Boolean {
    val lower = body.lowercase()
    return keywords.any { lower.contains(it) }
  }
}
