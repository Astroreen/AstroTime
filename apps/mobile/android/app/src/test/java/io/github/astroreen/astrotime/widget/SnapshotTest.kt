// The schedule widget's snapshot read into rows (docs/plans/android.md#D317)
// on the JVM: the days before today left out, the date beside each day's
// first row, today's line when it has nothing, and nothing from a snapshot
// that does not read.
package io.github.astroreen.astrotime.widget

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SnapshotTest {
    private val deviceToday = DayMark("Sun", "10", "Sunday, January 10, 2027", true)
    private val locales = mutableListOf<String?>()

    /** The device's words of today, the locale asked kept. */
    private fun deviceWords(locale: String?): Today {
        locales += locale
        return Today(deviceToday, "January")
    }

    private fun item(title: String, time: String?, done: Boolean = false) =
        JSONObject()
            .put("kind", "item")
            .put("title", title)
            .put("time", time ?: JSONObject.NULL)
            .put("fill", "#318362")
            .put("task", done)
            .put("done", done)
            .put("label", "$title, ${time ?: "All day"}")
            .put("open", JSONObject().put("kind", "item").put("objectId", title))

    private fun day(day: String, weekday: String, month: String, vararg rows: JSONObject) =
        JSONObject()
            .put("day", day)
            .put("weekday", weekday)
            .put("date", day.takeLast(2).trimStart('0'))
            .put("month", month)
            .put("label", "$weekday $day")
            .put("rows", JSONArray(rows.toList()))

    private val snapshot =
        JSONObject()
            .put("version", 1)
            .put("empty", "Nothing planned today")
            .put("create", "New event")
            .put("beyond", "Откройте AstroTime")
            .put("locale", "ru")
            .put(
                "days",
                JSONArray()
                    .put(
                        day(
                            "2026-11-24",
                            "Tue",
                            "November",
                            JSONObject()
                                .put("kind", "undone")
                                .put("text", "2 undone tasks")
                                .put("fill", "#4178b5")
                                .put("open", JSONObject().put("kind", "day").put("day", "2026-11-24")),
                            item("Caspian", null),
                        ),
                    )
                    .put(day("2026-11-25", "Wed", "November", item("Pick up mum", "06:40")))
                    // Days with nothing are named too (the snapshot names every day of its range).
                    .put(day("2026-11-26", "Thu", "November"))
                    .put(day("2026-11-30", "Mon", "November"))
                    .put(day("2026-12-01", "Tue", "December", item("Exam", "16:20–17:55"), item("Report", null, done = true))),
            )
            .toString()

    @Test
    fun `on its own day the undone row comes first, each day's date beside its first row`() {
        val shown = Snapshot.read(snapshot, "2026-11-24", { deviceWords(it) }, "Open AstroTime")
        assertEquals("November", shown.title)
        assertEquals("New event", shown.create)
        assertEquals(5, shown.rows.size)
        val undone = shown.rows[0] as Row.Undone
        assertEquals("2 undone tasks", undone.text)
        assertEquals(DayMark("Tue", "24", "Tue 2026-11-24", true), undone.mark)
        assertEquals(0xFF4178B5.toInt(), undone.fill)
        assertEquals("""{"kind":"day","day":"2026-11-24"}""", undone.open)
        val caspian = shown.rows[1] as Row.Item
        assertNull(caspian.mark)
        assertNull(caspian.time)
        assertEquals(DayMark("Wed", "25", "Wed 2026-11-25", false), shown.rows[2].mark)
        val report = shown.rows[4] as Row.Item
        assertTrue(report.done)
        assertNull(report.mark)
    }

    @Test
    fun `days gone by are left out, and the header names the first day's month`() {
        val shown = Snapshot.read(snapshot, "2026-11-25", { deviceWords(it) }, "Open AstroTime")
        assertEquals(listOf("Pick up mum", "Exam", "Report"), shown.rows.map { (it as Row.Item).title })
        assertEquals("November", shown.title)
        assertTrue(shown.rows[0].mark!!.today)
    }

    @Test
    fun `today with nothing on it heads the list in the snapshot's words, and names the month`() {
        // November 30, the next item on December 1: the month is still November.
        val shown = Snapshot.read(snapshot, "2026-11-30", { deviceWords(it) }, "Open AstroTime")
        assertEquals(Row.Empty(DayMark("Mon", "30", "Mon 2026-11-30", true), "Nothing planned today"), shown.rows[0])
        assertEquals("November", shown.title)
        assertEquals("Exam", (shown.rows[1] as Row.Item).title)
        assertEquals(false, shown.rows[1].mark!!.today)
    }

    @Test
    fun `another day with nothing on it is left out`() {
        val shown = Snapshot.read(snapshot, "2026-11-25", { deviceWords(it) }, "Open AstroTime")
        assertTrue(shown.rows.none { it.mark?.date == "26" })
    }

    @Test
    fun `a snapshot older than its range names today in the device's words`() {
        val shown = Snapshot.read(snapshot, "2027-01-10", { deviceWords(it) }, "Open AstroTime")
        // It knows nothing of today: never "nothing planned"; the snapshot's
        // words to open the app, the device's date in the snapshot's locale.
        assertEquals(listOf(Row.Empty(deviceToday, "Откройте AstroTime")), shown.rows)
        assertEquals(listOf("ru"), locales)
        assertEquals("January", shown.title)
    }

    @Test
    fun `no snapshot, or one that does not read, has no rows`() {
        for (json in listOf(null, "", "not json", """{"version":2,"days":[]}""")) {
            val shown = Snapshot.read(json, "2026-11-24", { deviceWords(it) }, "Open AstroTime")
            assertEquals(Shown(null, null, emptyList()), shown)
        }
    }

    @Test
    fun `a colour is read only as #rrggbb`() {
        assertEquals(0xFF318362.toInt(), Snapshot.colorOf("#318362"))
        assertNull(Snapshot.colorOf("green"))
        assertNull(Snapshot.colorOf("#abc"))
    }
}
