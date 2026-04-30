package expo.modules.transactionsmsreader

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.provider.Telephony
import android.util.Log
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.withContext

/**
 * Bridges Kotlin to JS via Expo's `Module` DSL.
 *
 * Public surface (matches `ExpoTransactionSmsReaderModule.ts`):
 *   - getPermissionStatusAsync()
 *   - requestPermissionsAsync()
 *   - openAppSettings()
 *   - startListening({ deduplicate, extraKeywords })
 *   - stopListening()
 *   - isListening()
 *   - getRecentMessages({ limit, sinceTimestamp, onlyTransactionsHint })
 *
 * Events:
 *   - onSmsReceived  — { raw: RawSmsMessage }
 *   - onError        — { code, message }
 */
class ExpoTransactionSmsReaderModule : Module() {

  // -------------------------------------------------------------------------
  // State — module instances are kept around for the lifetime of the JS
  // runtime, so we can safely store the receiver here. All state changes go
  // through `synchronized(stateLock)` to keep concurrent JS calls honest.
  // -------------------------------------------------------------------------

  private val stateLock = Any()
  private var receiver: SmsBroadcastReceiver? = null
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

  private val context: Context
    get() = appContext.reactContext
      ?: throw CodedException("ERR_NO_CONTEXT", "Android context is unavailable.", null)

  override fun definition() = ModuleDefinition {
    Name(MODULE_NAME)

    Events(EVENT_SMS_RECEIVED, EVENT_ERROR)

    // ---------------------------------------------------------------------
    // Permissions
    // ---------------------------------------------------------------------

    AsyncFunction("getPermissionStatusAsync") {
      // Use the activity-aware variant when possible so we can distinguish
      // BLOCKED ("don't ask again") from plain DENIED.
      PermissionHelper.currentStatus(appContext).value
    }

    AsyncFunction("requestPermissionsAsync") Coroutine { ->
      try {
        PermissionHelper.request(appContext).value
      } catch (e: CodedException) {
        emitError(e.code, e.message ?: "Unknown error")
        SmsPermissionStatus.DENIED.value
      }
    }

    Function("openAppSettings") {
      try {
        PermissionHelper.openAppSettings(context)
      } catch (t: Throwable) {
        Log.w(TAG, "Failed to open app settings", t)
        emitError("ERR_OPEN_SETTINGS", t.message ?: "Could not open app settings.")
      }
    }

    // ---------------------------------------------------------------------
    // Listener
    // ---------------------------------------------------------------------

    AsyncFunction("startListening") { options: StartListeningOptions ->
      synchronized(stateLock) {
        if (receiver != null) return@AsyncFunction // idempotent

        if (PermissionHelper.currentStatus(context) != SmsPermissionStatus.GRANTED) {
          throw CodedException(
            "ERR_PERMISSION_DENIED",
            "Cannot start listening — READ_SMS / RECEIVE_SMS not granted.",
            null
          )
        }

        val rec = SmsBroadcastReceiver(
          listener = { payload -> emitSmsReceived(payload) },
          deduplicate = options.deduplicate,
          extraKeywords = options.extraKeywords
        )

        val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION).apply {
          // High priority so we run before the default messaging app's
          // receiver — useful when other apps abort the broadcast.
          priority = 999
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
          // Android 13+ requires an explicit export flag for runtime receivers.
          context.registerReceiver(rec, filter, Context.RECEIVER_EXPORTED)
        } else {
          context.registerReceiver(rec, filter)
        }

        receiver = rec
        Log.i(TAG, "Started SMS broadcast listener.")
      }
    }

    AsyncFunction("stopListening") {
      synchronized(stateLock) {
        receiver?.let { rec ->
          try {
            context.unregisterReceiver(rec)
          } catch (e: IllegalArgumentException) {
            // Already unregistered — nothing to do.
          }
        }
        receiver = null
      }
    }

    Function("isListening") {
      synchronized(stateLock) { receiver != null }
    }

    // ---------------------------------------------------------------------
    // Inbox query
    // ---------------------------------------------------------------------

    AsyncFunction("getRecentMessages") Coroutine { options: GetRecentMessagesOptions ->
      if (PermissionHelper.currentStatus(context) != SmsPermissionStatus.GRANTED) {
        throw CodedException(
          "ERR_PERMISSION_DENIED",
          "READ_SMS not granted — request permissions before calling getRecentMessages.",
          null
        )
      }

      withContext(Dispatchers.IO) {
        SmsInboxReader.query(
          context,
          limit = options.limit.coerceIn(1, 500),
          sinceTimestamp = options.sinceTimestamp,
          onlyTransactionsHint = options.onlyTransactionsHint
        ).map { it.toBundle() }
      }
    }

    // ---------------------------------------------------------------------
    // Lifecycle
    // ---------------------------------------------------------------------

    OnDestroy {
      synchronized(stateLock) {
        receiver?.let {
          try { context.unregisterReceiver(it) } catch (_: Throwable) {}
        }
        receiver = null
      }
      scope.cancel()
    }
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private fun emitSmsReceived(payload: SmsBroadcastReceiver.RawSmsPayload) {
    try {
      sendEvent(EVENT_SMS_RECEIVED, Bundle().apply {
        putBundle("raw", payload.toBundle())
      })
    } catch (t: Throwable) {
      Log.e(TAG, "Failed to emit onSmsReceived", t)
    }
  }

  private fun emitError(code: String, message: String) {
    try {
      sendEvent(EVENT_ERROR, Bundle().apply {
        putString("code", code)
        putString("message", message)
      })
    } catch (_: Throwable) { /* swallow — telemetry only */ }
  }

  private fun SmsBroadcastReceiver.RawSmsPayload.toBundle(): Bundle = Bundle().apply {
    putString("id", id)
    putString("address", address)
    putString("body", body)
    putDouble("timestamp", timestamp.toDouble())
    if (subscriptionId != null) putInt("subscriptionId", subscriptionId)
    // null subscriptionId is encoded as "missing key" — the JS layer maps it
    // to `null` in the public `RawSmsMessage` shape.
  }

  // -------------------------------------------------------------------------
  // Records — argument records the Expo Modules runtime auto-binds from JS.
  // -------------------------------------------------------------------------

  internal class StartListeningOptions : expo.modules.kotlin.records.Record {
    @expo.modules.kotlin.records.Field
    var deduplicate: Boolean = true

    @expo.modules.kotlin.records.Field
    var extraKeywords: List<String> = emptyList()
  }

  internal class GetRecentMessagesOptions : expo.modules.kotlin.records.Record {
    @expo.modules.kotlin.records.Field
    var limit: Int = 50

    @expo.modules.kotlin.records.Field
    var sinceTimestamp: Long = 0L

    @expo.modules.kotlin.records.Field
    var onlyTransactionsHint: List<String> = emptyList()
  }

  companion object {
    const val MODULE_NAME = "ExpoTransactionSmsReader"
    const val EVENT_SMS_RECEIVED = "onSmsReceived"
    const val EVENT_ERROR = "onError"
    private const val TAG = "ExpoTxnSmsReader"
  }
}
