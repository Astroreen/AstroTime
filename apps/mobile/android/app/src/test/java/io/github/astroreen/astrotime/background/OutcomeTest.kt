// A run's outcome within its limit (docs/plans/android.md#D67), on the test
// dispatcher's virtual time: a run that never ends is stopped at the limit
// and cancelled (which destroys its WebView), with no real waiting.
package io.github.astroreen.astrotime.background

import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import kotlin.coroutines.cancellation.CancellationException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

private const val LIMIT_MS = 9 * 60_000L

class OutcomeTest {
    @Test
    fun `a run that never ends is stopped at the limit, and cancelled`() = runTest {
        var cancelled = false
        val outcome =
            outcomeOf(LIMIT_MS) {
                try {
                    awaitCancellation()
                } finally {
                    cancelled = true
                }
            }
        assertEquals("stopped after 9 minutes", outcome)
        assertEquals(LIMIT_MS, currentTime)
        assertTrue(cancelled)
    }

    @Test
    fun `any failure is an outcome, not the worker's`() = runTest {
        assertEquals(
            "failed: java.lang.IllegalStateException: WebView is being updated",
            outcomeOf(LIMIT_MS) { throw IllegalStateException("WebView is being updated") },
        )
        // Reading the credentials fails before any run: still an outcome.
        assertEquals(
            "failed: java.security.KeyStoreException: Keystore locked",
            jobOutcome(false, { throw java.security.KeyStoreException("Keystore locked") }) { "ran" },
        )
    }

    @Test
    fun `a cancellation goes on up`() = runTest {
        assertThrows(CancellationException::class.java) {
            kotlinx.coroutines.runBlocking { outcomeOf(LIMIT_MS) { throw CancellationException("stopped by WorkManager") } }
        }
    }

    @Test
    fun `in front or without credentials nothing runs`() = runTest {
        assertEquals(APP_OPEN, jobOutcome(true, { true }) { throw AssertionError("ran") })
        assertEquals(NO_ACCOUNT, jobOutcome(false, { false }) { throw AssertionError("ran") })
        assertEquals("ran", jobOutcome(false, { true }) { "ran" })
    }

    @Test
    fun `a report is the outcome, a failure says why`() = runTest {
        assertEquals("""{"report":{"accounts":[]}}""", outcomeOf(LIMIT_MS) { JSONObject("""{"report":{"accounts":[]}}""") })
        assertEquals("failed: The page found no AstroTimeBackground.", outcomeOf(LIMIT_MS) { throw RunFailed("The page found no AstroTimeBackground.") })
    }
}
