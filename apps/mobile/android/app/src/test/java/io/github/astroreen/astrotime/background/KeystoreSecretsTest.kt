// The credentials as `@aparajita/capacitor-secure-storage` 8.0.1 writes them
// (docs/plans/android.md#D64), read back without its plugin (D67): the same
// cipher and layout, under a JVM key instead of the Keystore's.
package io.github.astroreen.astrotime.background

import java.io.File
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.json.JSONObject
import org.junit.Test

/** The plugin's version whose format `readSecret` and `KeystoreSecrets` read. */
private const val READ_FORMAT_OF = "8.0.1"

class KeystoreSecretsTest {
    @Test
    fun `the installed plugin is the version whose format is read`() {
        // Gradle runs the JVM tests in app/; the plugin is apps/mobile's dependency.
        val manifest = File("../../node_modules/@aparajita/capacitor-secure-storage/package.json")
        val version = JSONObject(manifest.readText()).getString("version")
        assertEquals(
            "@aparajita/capacitor-secure-storage is $version: re-check KeystoreSecrets against its " +
                "SecureStorage.java and base.ts (docs/plans/android.md#D67), then move READ_FORMAT_OF",
            READ_FORMAT_OF,
            version,
        )
    }

    private val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
    private val decode: (String) -> ByteArray = Base64.getDecoder()::decode

    /** As the plugin's `encryptString`: ciphertext, U+0010, IV, each base64 without padding. */
    private fun seal(text: String, with: SecretKey = key): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, with) }
        val encoder = Base64.getEncoder().withoutPadding()
        val data = encoder.encodeToString(cipher.doFinal(text.toByteArray()))
        return data + '\u0010' + encoder.encodeToString(cipher.iv)
    }

    @Test
    fun `reads what the plugin sealed`() {
        val credentials = """{"username":"анна","password":"p4ss"}"""
        assertEquals(credentials, readSecret(seal(credentials), key, decode))
    }

    @Test
    fun `none kept, or no key, reads as none`() {
        assertNull(readSecret(null, key, decode))
        assertNull(readSecret(seal("x"), null, decode))
    }

    @Test
    fun `malformed or sealed under another key reads as none`() {
        val other = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        assertNull(readSecret(seal("x", other), key, decode))
        assertNull(readSecret("no separator", key, decode))
        assertNull(readSecret("!!!\u0010???", key, decode))
    }

    @Test
    fun `any other failure is said`() {
        val wrongKind = KeyGenerator.getInstance("HmacSHA256").generateKey()
        assertThrows(java.security.GeneralSecurityException::class.java) { readSecret(seal("x"), wrongKind, decode) }
    }
}
