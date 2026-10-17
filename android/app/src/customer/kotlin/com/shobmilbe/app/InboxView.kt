package com.shobmilbe.app

import android.content.Context
import android.content.SharedPreferences
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Locale
import java.util.TimeZone
import kotlin.concurrent.thread
import kotlin.math.max

/**
 * The ইনবক্স tab: a real Android screen (not a web page).
 * Top: buttons to talk to the shop (WhatsApp / Messenger / call).
 * Below: the shop's offer messages from the last 30 days (Admin → মার্কেটিং → ফোনে অফারের নোটিফিকেশন),
 * newest first; unread ones have a blue dot. Data: /api/app/inbox.
 */
class InboxView(private val act: MainActivity) : FrameLayout(act) {

    private val scroll = ScrollView(act).apply { isFillViewport = true }
    private val list = LinearLayout(act).apply {
        orientation = LinearLayout.VERTICAL
        setPadding(dp(16), dp(8), dp(16), dp(24))
    }
    private val ui = Handler(Looper.getMainLooper())
    private var loading = false
    private var last: JSONObject? = null // last answer, shown at once next time
    private var seenBefore = -1L         // what was already read when this screen opened (keeps the dots for this visit)

    init {
        setBackgroundColor(0xFFF5F7FB.toInt())
        isClickable = true // touches never reach the page underneath
        scroll.addView(list, LayoutParams(MATCH_PARENT, WRAP_CONTENT))
        addView(scroll, LayoutParams(MATCH_PARENT, MATCH_PARENT))
        render(null, false)
    }

    fun scrollToTop() = scroll.smoothScrollTo(0, 0)

    /** Fetch the inbox. visible = the person is looking at it now (then everything counts as read). */
    fun load(visible: Boolean) {
        val shown = last
        if (visible && shown != null) { render(shown, false); markRead(shown) } else if (visible) render(null, false)
        if (loading) return
        loading = true
        thread {
            val r = runCatching { JSONObject(Net.get("https://${MainActivity.HOST}/api/app/inbox", 300_000)) }.getOrNull()
            ui.post {
                loading = false
                if (r != null) last = r
                val now = last
                if (visibility == VISIBLE) {
                    render(now, r == null && now == null)
                    if (now != null) markRead(now)
                } else if (r != null) {
                    act.setInboxUnread(newestId(r) > prefs().getLong("inbox_seen", 0))
                }
            }
        }
    }

    private fun prefs(): SharedPreferences = act.getSharedPreferences("app", Context.MODE_PRIVATE)

    private fun newestId(r: JSONObject): Long {
        val items = r.optJSONArray("items") ?: return 0L
        return (0 until items.length()).maxOfOrNull { items.optJSONObject(it)?.optLong("id") ?: 0L } ?: 0L
    }

    private fun markRead(r: JSONObject) {
        val newest = newestId(r)
        val seen = prefs().getLong("inbox_seen", 0)
        if (seenBefore < 0) seenBefore = seen
        if (newest > seen) prefs().edit().putLong("inbox_seen", newest).apply()
        act.setInboxUnread(false)
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        if (changedView === this && visibility != VISIBLE) seenBefore = -1
    }

    // ---------------- drawing ----------------
    private fun render(r: JSONObject?, failed: Boolean) {
        list.removeAllViews()
        list.addView(text(act.getString(R.string.inbox_title), 22, MainActivity.INK, true).apply { setPadding(dp(2), dp(10), 0, dp(12)) })

        if (r == null) {
            if (failed) {
                list.addView(emptyCard(act.getString(R.string.inbox_failed), retry = true))
            } else {
                list.addView(LinearLayout(act).apply {
                    gravity = Gravity.CENTER
                    setPadding(0, dp(40), 0, 0)
                    addView(ProgressBar(act), LinearLayout.LayoutParams(dp(32), dp(32)))
                })
            }
            return
        }

        // talk to the shop
        val wa = r.optString("wa")
        val ms = r.optString("messenger")
        val phone = r.optString("phone")
        if (wa.isNotEmpty() || ms.isNotEmpty() || phone.isNotEmpty()) {
            list.addView(section(act.getString(R.string.inbox_contact)))
            val row = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL }
            if (wa.isNotEmpty()) addContact(row, "💬", act.getString(R.string.inbox_whatsapp), 0xFF16A34A.toInt(), "https://wa.me/$wa")
            if (ms.isNotEmpty()) addContact(row, "✉️", act.getString(R.string.inbox_messenger), 0xFF2563EB.toInt(), ms)
            if (phone.isNotEmpty()) addContact(row, "📞", act.getString(R.string.inbox_call), MainActivity.PRIMARY, "tel:${phone.replace(Regex("[^0-9+]"), "")}")
            list.addView(row, LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(18) })
        }

        // offer messages
        list.addView(section(act.getString(R.string.inbox_offers)))
        val items = r.optJSONArray("items")
        if (items == null || items.length() == 0) {
            list.addView(emptyCard(act.getString(R.string.inbox_empty), retry = false))
            return
        }
        val seen = if (seenBefore >= 0) seenBefore else prefs().getLong("inbox_seen", 0)
        for (i in 0 until items.length()) {
            val o = items.optJSONObject(i) ?: continue
            list.addView(messageCard(o, unread = o.optLong("id") > seen))
        }
    }

    private fun addContact(row: LinearLayout, emoji: String, label: String, color: Int, link: String) {
        val b = LinearLayout(act).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(dp(6), dp(14), dp(6), dp(12))
            background = card()
            isClickable = true
            isFocusable = true
            addView(text(emoji, 22, color, false).apply { gravity = Gravity.CENTER })
            addView(text(label, 13, MainActivity.INK, true).apply {
                gravity = Gravity.CENTER
                setPadding(0, dp(4), 0, 0)
            })
            setOnClickListener { act.openOutside(Uri.parse(link)) }
        }
        row.addView(b, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f).apply { if (row.childCount > 0) leftMargin = dp(10) })
    }

    private fun messageCard(o: JSONObject, unread: Boolean): View {
        val c = LinearLayout(act).apply {
            orientation = LinearLayout.HORIZONTAL
            setPadding(dp(14), dp(14), dp(14), dp(14))
            background = card()
            isClickable = true
            isFocusable = true
        }

        val img = o.optString("image")
        if (img.isNotEmpty()) {
            val iv = ImageView(act).apply {
                scaleType = ImageView.ScaleType.CENTER_CROP
                background = GradientDrawable().apply {
                    setColor(0xFFEEF2F7.toInt())
                    cornerRadius = dp(10).toFloat()
                }
                clipToOutline = true
            }
            c.addView(iv, LinearLayout.LayoutParams(dp(64), dp(64)).apply { rightMargin = dp(12) })
            loadImage(iv, img)
        }

        val col = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL }
        val top = LinearLayout(act).apply { gravity = Gravity.CENTER_VERTICAL }
        if (unread) {
            val dot = View(act).apply {
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(MainActivity.PRIMARY)
                }
            }
            top.addView(dot, LinearLayout.LayoutParams(dp(8), dp(8)).apply { rightMargin = dp(6) })
        }
        top.addView(text(o.optString("title"), 15, MainActivity.INK, true).apply {
            maxLines = 2
            ellipsize = TextUtils.TruncateAt.END
        }, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        col.addView(top)

        val body = o.optString("body")
        if (body.isNotEmpty()) {
            col.addView(text(body, 13, 0xFF4B5563.toInt(), false).apply {
                maxLines = 3
                ellipsize = TextUtils.TruncateAt.END
                setPadding(0, dp(4), 0, 0)
            })
        }
        val bottom = LinearLayout(act).apply { setPadding(0, dp(8), 0, 0) }
        bottom.addView(text(ago(o.optString("at")), 12, MainActivity.MUTED, false), LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))
        bottom.addView(text(act.getString(R.string.inbox_open), 12, MainActivity.PRIMARY, true))
        col.addView(bottom)
        c.addView(col, LinearLayout.LayoutParams(0, WRAP_CONTENT, 1f))

        val url = o.optString("url", "/")
        c.setOnClickListener {
            val target = if (url.startsWith("/")) "https://${MainActivity.HOST}$url" else url
            val u = Uri.parse(target)
            if (MainActivity.isShop(u)) act.openFromInbox(target) else act.openOutside(u)
        }
        c.layoutParams = LinearLayout.LayoutParams(MATCH_PARENT, WRAP_CONTENT).apply { bottomMargin = dp(10) }
        return c
    }

    private fun emptyCard(msg: String, retry: Boolean): View = LinearLayout(act).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER
        setPadding(dp(20), dp(28), dp(20), dp(28))
        background = card()
        addView(text(if (retry) "📶" else "📭", 36, MainActivity.INK, false).apply { gravity = Gravity.CENTER })
        addView(text(msg, 14, 0xFF4B5563.toInt(), false).apply {
            gravity = Gravity.CENTER
            setPadding(0, dp(8), 0, 0)
        })
        if (retry) {
            val b = text(act.getString(R.string.inbox_retry), 14, Color.WHITE, true).apply {
                setPadding(dp(22), dp(10), dp(22), dp(10))
                background = GradientDrawable().apply {
                    setColor(MainActivity.PRIMARY)
                    cornerRadius = dp(10).toFloat()
                }
                setOnClickListener { render(null, false); load(true) }
            }
            addView(b, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(16) })
        }
    }

    private fun section(s: String) = text(s, 13, MainActivity.MUTED, true).apply { setPadding(dp(2), 0, 0, dp(8)) }

    private fun text(s: String, sp: Int, color: Int, bold: Boolean) = TextView(act).apply {
        text = s
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sp.toFloat())
        setTextColor(color)
        if (bold) typeface = Typeface.DEFAULT_BOLD
    }

    private fun card() = GradientDrawable().apply {
        setColor(Color.WHITE)
        cornerRadius = dp(14).toFloat()
        setStroke(max(1, dp(1) / 2 + 1), MainActivity.LINE)
    }

    private fun dp(v: Int) = act.dp(v)

    /** "৩ ঘণ্টা আগে", "২ দিন আগে" … */
    private fun ago(iso: String): String = runCatching {
        val at = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US).apply { timeZone = TimeZone.getTimeZone("UTC") }.parse(iso.take(19))!!
        val min = max(0L, (System.currentTimeMillis() - at.time) / 60_000)
        when {
            min < 1 -> "এইমাত্র"
            min < 60 -> "${MainActivity.bn(min.toInt())} মিনিট আগে"
            min / 60 < 24 -> "${MainActivity.bn((min / 60).toInt())} ঘণ্টা আগে"
            else -> "${MainActivity.bn((min / 60 / 24).toInt())} দিন আগে"
        }
    }.getOrDefault("")

    // ---------------- network ----------------
    private fun loadImage(iv: ImageView, path: String) {
        thread {
            val u = if (path.startsWith("/")) "https://${MainActivity.HOST}$path" else path
            val bm: Bitmap? = if (!MainActivity.isShop(Uri.parse(u))) null else runCatching {
                val c = URL(u).openConnection() as HttpURLConnection
                c.connectTimeout = 10_000
                c.readTimeout = 15_000
                try {
                    c.inputStream.use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = 2 }) }
                } finally { c.disconnect() }
            }.getOrNull()
            if (bm != null) ui.post { iv.setImageBitmap(bm) }
        }
    }
}
