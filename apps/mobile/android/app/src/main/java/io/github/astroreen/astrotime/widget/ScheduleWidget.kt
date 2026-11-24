// The home screen's schedule widget (docs/plans/android.md#D317): the month
// and "+" over a list of the days ahead that scrolls freely, drawn from the
// snapshot the UI hands over (`ShellPlugin.showWidget`, background sync's
// `widget.show`). Kept in a file of the app's, so the widget draws with the
// app closed; drawn again when a snapshot comes and at midnight, when the
// day before leaves it. A tap opens the app on what was tapped
// (apps/mobile/src/widget.ts).
package io.github.astroreen.astrotime.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.AtomicFile
import android.widget.RemoteViews
import io.github.astroreen.astrotime.MainActivity
import io.github.astroreen.astrotime.R
import java.io.File
import java.io.IOException
import java.text.DateFormat
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Locale

class ScheduleWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        draw(context, manager, ids)
    }

    override fun onReceive(context: Context, intent: Intent) {
        super.onReceive(context, intent)
        when (intent.action) {
            // Midnight, or the clock or the zone moved: another day heads the list.
            MIDNIGHT, Intent.ACTION_TIME_CHANGED, Intent.ACTION_TIMEZONE_CHANGED, Intent.ACTION_LOCALE_CHANGED ->
                redraw(context)
        }
    }

    override fun onEnabled(context: Context) = atMidnight(context)

    override fun onDisabled(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(midnightIntent(context))
    }

    companion object {
        private const val MIDNIGHT = "io.github.astroreen.astrotime.widget.MIDNIGHT"

        /** The app's own scheme: `/widget?open=<JSON>` is a tap (apps/mobile/src/widget.ts). */
        private const val OPEN_URL = "io.github.astroreen.astrotime:/widget"

        private fun file(context: Context) = AtomicFile(File(context.filesDir, "widget/schedule.json"))

        /** Held while the file is written or read, never while drawing. */
        private val lock = Any()

        /**
         * Keeps `json` (the UI's `ScheduleSnapshot`), when `allowed` still
         * says so, and draws every widget from it. The drawing is outside the lock: asking for the list's rows
         * again reaches `ScheduleService`, which reads the file, in this
         * process, and waits for the answer.
         */
        fun keep(context: Context, json: String, allowed: () -> Boolean = { true }) {
            synchronized(lock) {
                // Asked under the lock, so no write of the open app's comes between the answer and this one.
                if (!allowed()) return
                val file = file(context)
                // The open app hands one at every change: the same as the widget has is not drawn again.
                val had =
                    try {
                        file.readFully().toString(Charsets.UTF_8)
                    } catch (error: IOException) {
                        null
                    }
                if (had == json) return
                file.baseFile.parentFile?.mkdirs()
                val out = file.startWrite()
                try {
                    out.write(json.toByteArray(Charsets.UTF_8))
                    file.finishWrite(out)
                } catch (error: Throwable) {
                    file.failWrite(out)
                    throw error
                }
            }
            redraw(context)
        }

        /** The snapshot kept, or `null` before the first. */
        fun kept(context: Context): String? =
            synchronized(lock) {
                try {
                    file(context).readFully().toString(Charsets.UTF_8)
                } catch (error: IOException) {
                    null
                }
            }

        /**
         * What the widget shows now, on the device's today. `java.util`'s
         * calendar, not `java.time`: the app runs from Android 7.0 (API 24),
         * and `java.time` came with 8.0.
         */
        fun shown(context: Context): Shown {
            val at = Calendar.getInstance().time
            return Snapshot.read(
                kept(context),
                SimpleDateFormat("yyyy-MM-dd", Locale.ROOT).format(at),
                { tag -> todayIn(tag?.let(Locale::forLanguageTag) ?: Locale.getDefault()) },
                context.getString(R.string.widget_open_app),
            )
        }

        /** Today's date and month in `locale`. */
        private fun todayIn(locale: Locale): Today {
            val now = Calendar.getInstance()
            val at = now.time
            val mark =
                DayMark(
                    SimpleDateFormat("EEE", locale).format(at),
                    now.get(Calendar.DAY_OF_MONTH).toString(),
                    DateFormat.getDateInstance(DateFormat.FULL, locale).format(at),
                    true,
                )
            val month = SimpleDateFormat("LLLL", locale).format(at).replaceFirstChar { it.titlecase(locale) }
            return Today(mark, month)
        }

        /** Draws every widget on the home screen again, the list's rows too. */
        fun redraw(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, ScheduleWidget::class.java))
            if (ids.isEmpty()) return
            draw(context, manager, ids)
        }

        private fun draw(context: Context, manager: AppWidgetManager, ids: IntArray) {
            val shown = shown(context)
            for (id in ids) {
                val views = RemoteViews(context.packageName, R.layout.widget_schedule)
                views.setTextViewText(R.id.widget_title, shown.title ?: context.getString(R.string.app_name))
                shown.create?.let { views.setContentDescription(R.id.widget_create, it) }
                views.setOnClickPendingIntent(R.id.widget_title, opening(context, """{"kind":"day"}""", 0))
                views.setOnClickPendingIntent(R.id.widget_create, opening(context, """{"kind":"create"}""", 1))
                // The list's rows come from the service, one per id so each widget has its own.
                val service =
                    Intent(context, ScheduleService::class.java)
                        .putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID, id)
                        .apply { data = Uri.parse(toUri(Intent.URI_INTENT_SCHEME)) }
                @Suppress("DEPRECATION")
                views.setRemoteAdapter(R.id.widget_list, service)
                // Before the app's first snapshot: open AstroTime once.
                views.setEmptyView(R.id.widget_list, R.id.widget_empty)
                views.setOnClickPendingIntent(R.id.widget_empty, opening(context, """{"kind":"day"}""", 2))
                // Each row fills in what it opens (`ScheduleService`).
                views.setPendingIntentTemplate(R.id.widget_list, template(context))
                manager.updateAppWidget(id, views)
            }
            // The rows too: the service's address is the same, so the list would keep the rows it has.
            @Suppress("DEPRECATION")
            manager.notifyAppWidgetViewDataChanged(ids, R.id.widget_list)
            atMidnight(context)
        }

        /** The app, opening `open` (`WidgetOpen` as JSON). */
        fun openIntent(context: Context, open: String): Intent =
            Intent(context, MainActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setData(Uri.parse(OPEN_URL).buildUpon().appendQueryParameter("open", open).build())
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

        private fun opening(context: Context, open: String, request: Int): PendingIntent =
            PendingIntent.getActivity(
                context,
                request,
                openIntent(context, open),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        /** The rows' template: each fills in its own address, so it must stay mutable. */
        private fun template(context: Context): PendingIntent =
            PendingIntent.getActivity(
                context,
                3,
                Intent(context, MainActivity::class.java)
                    .setAction(Intent.ACTION_VIEW)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_UPDATE_CURRENT or
                    (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0),
            )

        /** A row's fill-in: the address of what it opens. */
        fun fillIn(open: String): Intent =
            Intent().setData(Uri.parse(OPEN_URL).buildUpon().appendQueryParameter("open", open).build())

        private fun midnightIntent(context: Context): PendingIntent =
            PendingIntent.getBroadcast(
                context,
                0,
                Intent(context, ScheduleWidget::class.java).setAction(MIDNIGHT),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )

        /**
         * Draws again just after the next midnight, within ten minutes of it
         * (the least window Android 12 and later give): a window, not an
         * exact alarm, so it needs no permission; without `_WAKEUP`, a phone
         * asleep sees it when it wakes.
         */
        private fun atMidnight(context: Context) {
            val next =
                Calendar.getInstance().apply {
                    add(Calendar.DAY_OF_YEAR, 1)
                    set(Calendar.HOUR_OF_DAY, 0)
                    set(Calendar.MINUTE, 0)
                    set(Calendar.SECOND, 1)
                    set(Calendar.MILLISECOND, 0)
                }
            context
                .getSystemService(AlarmManager::class.java)
                .setWindow(AlarmManager.RTC, next.timeInMillis, 10 * 60_000L, midnightIntent(context))
        }
    }
}
