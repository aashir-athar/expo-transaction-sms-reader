package expo.modules.transactionsmsreader

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.providers.CurrentActivityProvider
import kotlinx.coroutines.CompletableDeferred

/**
 * Maps Android's `PackageManager` granted/denied state to the public string
 * status returned by the JS API.
 */
internal enum class SmsPermissionStatus(val value: String) {
  GRANTED("granted"),
  DENIED("denied"),
  UNDETERMINED("undetermined")
}

internal object PermissionHelper {

  /** The two dangerous permissions this module needs. */
  val REQUIRED_PERMISSIONS = arrayOf(
    Manifest.permission.READ_SMS,
    Manifest.permission.RECEIVE_SMS
  )

  fun currentStatus(context: Context): SmsPermissionStatus {
    val read = ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS)
    val receive = ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS)
    return if (read == PackageManager.PERMISSION_GRANTED && receive == PackageManager.PERMISSION_GRANTED) {
      SmsPermissionStatus.GRANTED
    } else {
      // Android does not expose "undetermined" for runtime permissions — once
      // requested at least once, the status is always granted/denied. We map
      // everything that isn't granted to "denied" for simplicity, leaving
      // UNDETERMINED reserved for misconfigured manifests.
      SmsPermissionStatus.DENIED
    }
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

    val deferred = CompletableDeferred<SmsPermissionStatus>()

    permissionsManager.askForPermissions({ result ->
      val allGranted = REQUIRED_PERMISSIONS.all { perm ->
        val info = result[perm]
        info?.status == expo.modules.interfaces.permissions.PermissionsStatus.GRANTED
      }
      deferred.complete(if (allGranted) SmsPermissionStatus.GRANTED else SmsPermissionStatus.DENIED)
    }, *REQUIRED_PERMISSIONS)

    return deferred.await()
  }
}
