package com.shobmilbe.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Offer notifications for the customer app.
 * Every ~30 minutes (only when internet is on) the app asks the shop: "any new offer notification?".
 * When the owner sends one from Admin → Marketing → 🔔 ফোনে অফারের নোটিফিকেশন, it shows on the phone.
 * Free — no Firebase, no SMS.
 */
class OfferWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

    companion object {
        private const val CHANNEL = "offers"
        private const val ORDERS = "orders"

        /** This install's own random number (made once, never leaves the shop): lets the shop send this phone its own
         *  order news (parcel sent, delivered, review request). No name, number or contacts are read from the phone. */
        fun installId(ctx: Context): String {
            val p = ctx.getSharedPreferences("app", Context.MODE_PRIVATE)
            p.getString("install_id", null)?.let { if (it.length >= 16) return it }
            val id = java.util.UUID.randomUUID().toString()
            p.edit().putString("install_id", id).apply()
            return id
        }

        fun schedule(ctx: Context) {
            val req = PeriodicWorkRequestBuilder<OfferWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("offers", ExistingPeriodicWorkPolicy.KEEP, req)
        }

        private fun show(ctx: Context, id: Int, title: String, body: String, url: String, image: String, orders: Boolean = false) {
            if (title.isEmpty()) return
            if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val channel = if (orders) ORDERS else CHANNEL
            if (Build.VERSION.SDK_INT >= 26) {
                val nm = ctx.getSystemService(NotificationManager::class.java)
                if (nm != null && nm.getNotificationChannel(channel) == null) {
                    val name = ctx.getString(if (orders) R.string.orders_channel else R.string.offers_channel)
                    nm.createNotificationChannel(NotificationChannel(channel, name, if (orders) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_DEFAULT))
                }
            }
            var target = url.ifEmpty { "/" }
            if (target.startsWith("/")) target = "https://${MainActivity.HOST}$target"
            val open = Intent(ctx, MainActivity::class.java).apply {
                if (MainActivity.isShop(Uri.parse(target))) putExtra("url", target)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
            val pi = PendingIntent.getActivity(ctx, id, open, flags)

            val b = NotificationCompat.Builder(ctx, channel)
                .setSmallIcon(R.drawable.ic_notification)
                .setColor(MainActivity.PRIMARY)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(pi)
                .setAutoCancel(true)
            picture(image)?.let { pic -> b.setLargeIcon(pic).setStyle(NotificationCompat.BigPictureStyle().bigPicture(pic).setSummaryText(body)) }
            try { NotificationManagerCompat.from(ctx).notify((if (orders) 500_000 else 1000) + id, b.build()) } catch (e: SecurityException) { /* the person turned notifications off */ }
        }

        private fun picture(path: String): Bitmap? {
            if (path.isEmpty()) return null
            val u = if (path.startsWith("/")) "https://${MainActivity.HOST}$path" else path
            if (!MainActivity.isShop(Uri.parse(u))) return null
            return runCatching {
                val c = URL(u).openConnection() as HttpURLConnection
                c.connectTimeout = 10_000
                c.readTimeout = 15_000
                try { c.inputStream.use { BitmapFactory.decodeStream(it) } } finally { c.disconnect() }
            }.getOrNull()
        }
    }

    override fun doWork(): Result {
        val ctx = applicationContext
        val p = ctx.getSharedPreferences("app", Context.MODE_PRIVATE)
        val seen = p.getLong("offer_seen", -1)
        val noticeSeen = p.getLong("notice_seen", -1)
        return try {
            val dev = Uri.encode(installId(ctx))
            val mk = Uri.encode(Build.MANUFACTURER ?: "")
            val md = Uri.encode(Build.MODEL ?: "")
            val res = JSONObject(Net.get("https://${MainActivity.HOST}/api/app/offers?after=${maxOf(0L, seen)}&dev=$dev&n=$noticeSeen&mk=$mk&md=$md", 200_000))
            // this phone's own order news (parcel sent / delivered — please review / a message from the shop)
            if (noticeSeen < 0) {
                p.edit().putLong("notice_seen", res.optLong("noticeLatest", 0)).apply()
            } else res.optJSONArray("notices")?.let { list ->
                var top = noticeSeen
                for (i in 0 until list.length()) {
                    val o = list.getJSONObject(i)
                    val nid = o.optLong("id")
                    if (nid <= noticeSeen) continue
                    show(ctx, (nid % 400_000).toInt(), o.optString("title"), o.optString("body"), o.optString("url"), "", orders = true)
                    if (nid > top) top = nid
                }
                if (top > noticeSeen) p.edit().putLong("notice_seen", top).apply()
            }
            val latest = res.optLong("latest", 0)
            if (seen < 0) { // first run after install: start from now, don't show old offers
                p.edit().putLong("offer_seen", latest).apply()
                return Result.success()
            }
            res.optJSONArray("items")?.let { items ->
                for (i in 0 until items.length()) {
                    val o = items.getJSONObject(i)
                    show(ctx, o.optLong("id").toInt(), o.optString("title"), o.optString("body"), o.optString("url"), o.optString("image"))
                }
            }
            if (latest > seen) p.edit().putLong("offer_seen", latest).apply()
            Result.success()
        } catch (e: Exception) {
            Result.success() // try again next time; never crash
        }
    }
}
