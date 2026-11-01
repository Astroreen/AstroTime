// A run's outcome within its limit (docs/plans/android.md#D67), on the test
// dispatcher's virtual time: a run that never ends is stopped at the limit
// and cancelled (which destroys its WebView), with no real waiting.
package io.github.astroreen.astrotime.background

import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
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
    fun `a report is the outcome, a failure says why`() = runTest {
        assertEquals("""{"report":{"accounts":[]}}""", outcomeOf(LIMIT_MS) { JSONObject("""{"report":{"accounts":[]}}""") })
        assertEquals("failed: The page found no AstroTimeBackground.", outcomeOf(LIMIT_MS) { throw RunFailed("The page found no AstroTimeBackground.") })
    }
}
