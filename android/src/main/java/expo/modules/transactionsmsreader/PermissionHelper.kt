package expo.modules.transactionsmsreader

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import kotlinx.coroutines.CompletableDeferred

/**
 * Maps Android's `PackageManager` granted/denied state to the public string
 * status returned by the JS API. `BLOCKED` is reported when the user has
 * dismissed the runtime prompt with "Don't ask again" — the host app can no
 * longer show the prompt and must direct the user to system settings.
 */
internal enum class SmsPermissionStatus(val value: String) {
  GRANTED("granted"),
  DENIED("denied"),
  UNDETERMINED("undetermined"),
  BLOCKED("blocked")
}

internal object PermissionHelper {

  private const val PREFS_NAME = "expo_transaction_sms_reader_prefs"
  private const val KEY_PROMPT_SHOWN = "prompt_shown_once"

  /** The two dangerous permissions this module needs. */
  val REQUIRED_PERMISSIONS = arrayOf(
    Manifest.permission.READ_SMS,
    Manifest.permission.RECEIVE_SMS
  )

  fun currentStatus(context: Context): SmsPermissionStatus {
    val read = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
    val receive = ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS)
    if (read == PackageManager.PERMISSION_GRANTED && receive == PackageManager.PERMISSION_GRANTED) {
      return SmsPermissionStatus.GRANTED
    }

    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return if (prefs.getBoolean(KEY_PROMPT_SHOWN, false)) {
      // We have asked at least once — anything not granted is now denied.
      // The activity-aware status() below upgrades this to BLOCKED when
      // shouldShowRequestPermissionRationale is false post-prompt.
      SmsPermissionStatus.DENIED
    } else {
      SmsPermissionStatus.UNDETERMINED
    }
  }

  /**
   * Same as [currentStatus] but uses the current activity to detect the
   * `BLOCKED` case (user previously selected "Don't ask again").
   */
  fun currentStatus(appContext: AppContext): SmsPermissionStatus {
    val context = appContext.reactContext ?: return SmsPermissionStatus.UNDETERMINED
    val activity = appContext.activityProvider?.currentActivity
    val base = currentStatus(context)
    if (base != SmsPermissionStatus.DENIED || activity == null) return base

    val canStillAsk = REQUIRED_PERMISSIONS.any { perm ->
      ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)
    }
    return if (canStillAsk) SmsPermissionStatus.DENIED else SmsPermissionStatus.BLOCKED
  }

  /**
   * Triggers the runtime permission prompt via Expo's permission plumbing.
   * Resolves with the resulting status. Throws a [CodedException] when the
   * activity isn't available (e.g. headless background context).
   */
  suspend fun request(appContext: AppContext): SmsPermissionStatus {
    val activityProvider = appContext.activityProvider
      ?: throw CodedException("ERR_NO_ACTIVITY", "Cannot request permissions without an activity.", null)

    val activity = activityProvider.currentActivity
      ?: throw CodedException("ERR_NO_ACTIVITY", "Cannot request permissions without an activity.", null)

    val permissionsManager = appContext.permissions
      ?: throw CodedException(
        "ERR_NO_PERMISSIONS_MANAGER",
        "Expo permissions manager is not available — was `expo-modules-core` linked?",
        null
      )

    markPromptShown(activity)

    val deferred = CompletableDeferred<SmsPermissionStatus>()

    permissionsManager.askForPermissions({ result ->
      val allGranted = REQUIRED_PERMISSIONS.all { perm ->
        val info = result[perm]
        info?.status == expo.modules.interfaces.permissions.PermissionsStatus.GRANTED
      }
      val finalStatus = if (allGranted) {
        SmsPermissionStatus.GRANTED
      } else {
        // Detect BLOCKED — after the first prompt, if the rationale flag is
        // false the user picked "Don't ask again" and we can't prompt again.
        val canAskAgain = REQUIRED_PERMISSIONS.any { perm ->
          ActivityCompat.shouldShowRequestPermissionRationale(activity, perm)
        }
        if (canAskAgain) SmsPermissionStatus.DENIED else SmsPermissionStatus.BLOCKED
      }
      deferred.complete(finalStatus)
    }, *REQUIRED_PERMISSIONS)

    return deferred.await()
  }

  /**
   * Open the host app's settings page. Used by [openAppSettings] when the
   * user has blocked the prompt and the only path to grant is via settings.
   */
  fun openAppSettings(context: Context) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
      data = Uri.fromParts("package", context.packageName, null)
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
  }

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

  private fun markPromptShown(activity: Activity) {
    prefs(activity).edit().putBoolean(KEY_PROMPT_SHOWN, true).apply()
  }
}
