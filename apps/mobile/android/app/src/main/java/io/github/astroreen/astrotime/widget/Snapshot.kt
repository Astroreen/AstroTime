// The schedule widget's snapshot (docs/plans/android.md#D317), as the UI
// worked it out (packages/ui/src/widget/schedule.ts), read into the rows the
// list draws for a day: the days before it left out, its date beside the
// first row of each day, today's line when today has nothing. No Android
// API here, so the JVM tests run it as it is.
package io.github.astroreen.astrotime.widget

import org.json.JSONException
import org.json.JSONObject

/** Today in the device's words, past the snapshot's end: its date and its month. */
data class Today(val mark: DayMark, val month: String)

/** The date beside a day's first row. */
data class DayMark(val weekday: String, val date: String, val label: String, val today: Boolean)

sealed interface Row {
    /** Set on the day's first row only. */
    val mark: DayMark?

    /** What a tap asks the app to open, as JSON (`WidgetOpen` in packages/ui). */
    val open: String

    data class Item(
        override val mark: DayMark?,
        val title: String,
        /** `null`: all day, the title alone. */
        val time: String?,
        /** ARGB. */
        val fill: Int,
        val task: Boolean,
        val done: Boolean,
        val label: String,
        override val open: String,
    ) : Row

    data class Undone(override val mark: DayMark?, val text: String, val fill: Int, override val open: String) : Row

    /** Today with nothing on it: a tap opens today. */
    data class Empty(override val mark: DayMark?, val text: String) : Row {
        override val open = """{"kind":"day"}"""
    }
}

/** What the widget draws on `today` (`YYYY-MM-DD`, the device's). */
data class Shown(
    /** The month of the first day shown; `null` before the app's first snapshot. */
    val title: String?,
    val create: String?,
    val rows: List<Row>,
)

object Snapshot {
    /** The fill when a snapshot's colour does not read: the views' default calendar colour, darkened (`fillOf`). */
    private const val DEFAULT_FILL = 0xFF5D6B8C.toInt()

    /**
     * The rows of `json` from `today` on; nothing that reads (no snapshot
     * yet), no rows. The snapshot names every day up to where it ends (31
     * days, or the day its rows were cut), so today is among them while it
     * covers today; past its end, it knows nothing of today: today heads
     * the list in `todayWords` (the device's, in the snapshot's locale) with
     * the snapshot's `beyond` (to open the app; `beyond` here before a
     * snapshot had one), never "nothing planned". The title is the month of
     * the day that heads it.
     */
    fun read(json: String?, today: String, todayWords: (locale: String?) -> Today, beyond: String): Shown {
        val snapshot =
            try {
                json?.let(::JSONObject)?.takeIf { it.optInt("version") == 1 }
            } catch (error: JSONException) {
                null
            } ?: return Shown(null, null, emptyList())
        val days = snapshot.optJSONArray("days")
        val empty = snapshot.optString("empty")
        val rows = mutableListOf<Row>()
        var title: String? = null
        for (i in 0 until (days?.length() ?: 0)) {
            val day = days!!.optJSONObject(i) ?: continue
            val date = day.optString("day")
            if (date < today) continue
            val mark =
                DayMark(day.optString("weekday"), day.optString("date"), day.optString("label"), date == today)
            val list = day.optJSONArray("rows")
            val start = rows.size
            for (j in 0 until (list?.length() ?: 0)) {
                val row = list!!.optJSONObject(j) ?: continue
                rowOf(row, if (rows.size == start) mark else null)?.let(rows::add)
            }
            // Today heads the list, with nothing on it too; another day with nothing is left out.
            if (date == today && rows.size == start) rows += Row.Empty(mark, empty)
            if (rows.size > start) title = title ?: day.optString("month").ifEmpty { null }
        }
        if (rows.firstOrNull()?.mark?.today != true) {
            val words = todayWords(snapshot.text("locale"))
            rows.add(0, Row.Empty(words.mark, snapshot.text("beyond") ?: beyond))
            title = words.month
        }
        return Shown(title, snapshot.text("create"), rows)
    }

    private fun rowOf(row: JSONObject, mark: DayMark?): Row? {
        val open = row.optJSONObject("open")?.toString() ?: return null
        val fill = colorOf(row.optString("fill")) ?: DEFAULT_FILL
        return when (row.optString("kind")) {
            "item" ->
                Row.Item(
                    mark,
                    row.optString("title"),
                    if (row.isNull("time")) null else row.optString("time"),
                    fill,
                    row.optBoolean("task"),
                    row.optBoolean("done"),
                    row.optString("label"),
                    open,
                )
            "undone" -> Row.Undone(mark, row.optString("text"), fill, open)
            else -> null
        }
    }

    /** A string field; `null` when it is missing, empty or JSON's `null` (which `optString` reads as "null"). */
    private fun JSONObject.text(key: String): String? = if (isNull(key)) null else optString(key).ifEmpty { null }

    /** `#rrggbb` as opaque ARGB; `null` for anything else. */
    fun colorOf(hex: String): Int? {
        if (!Regex("^#[0-9a-fA-F]{6}$").matches(hex)) return null
        return (0xFF000000 or hex.substring(1).toLong(16)).toInt()
    }
}
