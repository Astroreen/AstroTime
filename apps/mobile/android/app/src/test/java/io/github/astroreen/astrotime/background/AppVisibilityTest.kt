// Whether the app is on the screen (docs/plans/android.md#D67): two
// activities at once (split screen), the one that stops leaves the other's.
package io.github.astroreen.astrotime.background

import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppVisibilityTest {
    @After
    fun away() {
        repeat(3) { AppVisibility.inFront = false }
    }

    @Test
    fun anOlderActivityStoppingLeavesTheNewerOneInFront() {
        AppVisibility.inFront = true
        AppVisibility.inFront = true
        AppVisibility.inFront = false
        assertTrue(AppVisibility.inFront)
        AppVisibility.inFront = false
        assertFalse(AppVisibility.inFront)
        // A stop with no start counts below nothing never.
        AppVisibility.inFront = false
        AppVisibility.inFront = true
        assertTrue(AppVisibility.inFront)
    }
}
