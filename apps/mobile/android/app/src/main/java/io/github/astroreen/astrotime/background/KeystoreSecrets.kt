// The credentials as `@aparajita/capacitor-secure-storage` keeps them
// (docs/plans/android.md#D64), read without its plugin, which needs
// Capacitor's bridge (D67): AES-GCM ciphertext and its IV in the shared
// preferences `WSSecureStorageSharedPreferences` under `capacitor-storage_`
// and the key, sealed by a Keystore key of the same alias. Read only.
package io.github.astroreen.astrotime.background

import android.content.Context
import android.util.Base64
import java.security.KeyStore
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** The plugin's names, from its 8.0.1 (`SecureStorage.java`, `base.ts`). */
private const val PREFERENCES = "WSSecureStorageSharedPreferences"
const val SECRET_PREFIX = "capacitor-storage_"
private const val SEPARATOR = '\u0010'

/**
 * The secret kept under `prefixed`, or `null`: none kept, malformed, or
 * sealed under another key (as `keystoreSecrets` reads it, apps/mobile/src/secrets.ts).
 * Any other failure is thrown, so the account's sync says it failed.
 */
fun readSecret(stored: String?, key: SecretKey?, decode: (String) -> ByteArray): String? {
    if (stored == null || key == null) return null
    val parts = stored.split(SEPARATOR)
    if (parts.size != 2) return null
    val (data, iv) =
        try {
            decode(parts[0]) to decode(parts[1])
        } catch (error: IllegalArgumentException) {
            return null
        }
    return try {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, iv))
        String(cipher.doFinal(data), Charsets.UTF_8)
    } catch (error: AEADBadTagException) {
        null
    }
}

class KeystoreSecrets(context: Context) : Secrets {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun get(key: String): String? {
        val prefixed = SECRET_PREFIX + key
        val stored = preferences.all[prefixed] as? String
        val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val entry = keyStore.getEntry(prefixed, null) as? KeyStore.SecretKeyEntry
        return readSecret(stored, entry?.secretKey) { Base64.decode(it, Base64.NO_PADDING or Base64.NO_WRAP) }
    }

    companion object {
        /** Whether any account's credentials are kept: without them a run has nothing to do. */
        fun anyAccount(context: Context): Boolean =
            context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).all.keys.any {
                it.startsWith("${SECRET_PREFIX}account:")
            }
    }
}
