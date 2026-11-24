// The schedule widget's list (docs/plans/android.md#D317): one row per item,
// the day's date beside its first, read from the snapshot kept
// (`ScheduleWidget.shown`) each time the widget asks for its rows again.
package io.github.astroreen.astrotime.widget

import android.content.Context
import android.content.Intent
import android.graphics.Paint
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import android.widget.RemoteViewsService
import io.github.astroreen.astrotime.R

@Suppress("DEPRECATION")
class ScheduleService : RemoteViewsService() {
    override fun onGetViewFactory(intent: Intent): RemoteViewsFactory = Rows(applicationContext)

    private class Rows(private val context: Context) : RemoteViewsFactory {
        // Set and read on the binder's threads, which may differ call to call.
        @Volatile private var rows: List<Row> = emptyList()

        override fun onCreate() {}

        override fun onDataSetChanged() {
            rows = ScheduleWidget.shown(context).rows
        }

        override fun onDestroy() {}

        override fun getCount() = rows.size

        override fun getViewAt(position: Int): RemoteViews {
            val views = RemoteViews(context.packageName, R.layout.widget_row)
            // Gone since the list was counted: a blank row until it is drawn again.
            val row = rows.getOrNull(position) ?: Row.Empty(null, "")
            mark(views, row.mark)
            when (row) {
                is Row.Item -> item(views, row)
                is Row.Undone -> undone(views, row)
                is Row.Empty -> empty(views, row)
            }
            views.setOnClickFillInIntent(R.id.row_card, ScheduleWidget.fillIn(row.open))
            return views
        }

        /** The date column: shown beside a day's first row, its room kept on the others. */
        private fun mark(views: RemoteViews, mark: DayMark?) {
            views.setViewVisibility(R.id.row_day, if (mark == null) View.INVISIBLE else View.VISIBLE)
            // A day's first row has room above it, as the days are set apart.
            views.setViewVisibility(R.id.row_gap, if (mark == null) View.GONE else View.VISIBLE)
            if (mark == null) return
            views.setTextViewText(R.id.row_weekday, mark.weekday)
            views.setTextViewText(R.id.row_date, mark.date)
            views.setContentDescription(R.id.row_day, mark.label)
            views.setViewVisibility(R.id.row_today, if (mark.today) View.VISIBLE else View.GONE)
            val color = if (mark.today) R.color.widget_on_today else R.color.widget_muted
            themed(views, R.id.row_weekday, "setTextColor", color)
            themed(views, R.id.row_date, "setTextColor", color)
        }

        private fun item(views: RemoteViews, row: Row.Item) {
            views.setViewVisibility(R.id.row_fill, View.VISIBLE)
            views.setInt(R.id.row_fill, "setColorFilter", row.fill)
            // A task's mark; an event has none, and its title starts where the mark would.
            views.setViewVisibility(R.id.row_mark, if (row.task) View.VISIBLE else View.GONE)
            views.setViewVisibility(R.id.row_badge, View.GONE)
            views.setViewVisibility(R.id.row_check, View.VISIBLE)
            views.setInt(R.id.row_check, "setColorFilter", WHITE)
            views.setImageViewResource(R.id.row_check, if (row.done) R.drawable.widget_check_done else R.drawable.widget_check)
            views.setTextViewText(R.id.row_title, row.title)
            views.setTextColor(R.id.row_title, WHITE)
            // A done task is struck through, as the app draws it (design D51).
            views.setInt(
                R.id.row_title,
                "setPaintFlags",
                Paint.ANTI_ALIAS_FLAG or (if (row.done) Paint.STRIKE_THRU_TEXT_FLAG else 0),
            )
            views.setViewVisibility(R.id.row_time, if (row.time == null) View.GONE else View.VISIBLE)
            views.setTextViewText(R.id.row_time, row.time ?: "")
            views.setContentDescription(R.id.row_card, row.label)
        }

        private fun undone(views: RemoteViews, row: Row.Undone) {
            // On the widget's own ground, a step raised; a white check in a
            // circle of the oldest task's colour, as the app's chip (design D51).
            views.setViewVisibility(R.id.row_fill, View.VISIBLE)
            themed(views, R.id.row_fill, "setColorFilter", R.color.widget_raised)
            views.setViewVisibility(R.id.row_mark, View.VISIBLE)
            views.setViewVisibility(R.id.row_badge, View.VISIBLE)
            views.setInt(R.id.row_badge, "setColorFilter", row.fill)
            views.setViewVisibility(R.id.row_check, View.VISIBLE)
            views.setImageViewResource(R.id.row_check, R.drawable.widget_check_mark)
            views.setInt(R.id.row_check, "setColorFilter", WHITE)
            views.setTextViewText(R.id.row_title, row.text)
            themed(views, R.id.row_title, "setTextColor", R.color.widget_ink)
            views.setInt(R.id.row_title, "setPaintFlags", Paint.ANTI_ALIAS_FLAG)
            views.setViewVisibility(R.id.row_time, View.GONE)
            views.setContentDescription(R.id.row_card, row.text)
        }

        private fun empty(views: RemoteViews, row: Row.Empty) {
            views.setViewVisibility(R.id.row_fill, View.INVISIBLE)
            views.setViewVisibility(R.id.row_mark, View.GONE)
            views.setTextViewText(R.id.row_title, row.text)
            themed(views, R.id.row_title, "setTextColor", R.color.widget_muted)
            views.setInt(R.id.row_title, "setPaintFlags", Paint.ANTI_ALIAS_FLAG)
            views.setViewVisibility(R.id.row_time, View.GONE)
            views.setContentDescription(R.id.row_card, row.text)
        }

        /**
         * A colour of the widget's theme: from Android 12 resolved by the
         * home screen, so it follows the system's dark theme as it changes;
         * before, the app's, as it is now.
         */
        private fun themed(views: RemoteViews, id: Int, method: String, color: Int) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) views.setColor(id, method, color)
            else views.setInt(id, method, context.getColor(color))
        }

        override fun getLoadingView(): RemoteViews? = null

        override fun getViewTypeCount() = 1

        override fun getItemId(position: Int) = position.toLong()

        override fun hasStableIds() = false
    }

    private companion object {
        const val WHITE = 0xFFFFFFFF.toInt()
    }
}
