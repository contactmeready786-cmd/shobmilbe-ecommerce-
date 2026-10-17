package com.shobmilbe.app

import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** Small JSON requests to the shop (inbox, offers) — the answer as text, never more than `limit` bytes. */
object Net {
    fun get(url: String, limit: Int): String {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 10_000
        c.readTimeout = 15_000
        c.setRequestProperty("Accept", "application/json")
        c.setRequestProperty("User-Agent", "ShobmilbeApp/${BuildConfig.VERSION_NAME} (Android)")
        try {
            c.inputStream.use { input ->
                val out = ByteArrayOutputStream()
                val buf = ByteArray(4096)
                while (true) {
                    val n = input.read(buf)
                    if (n <= 0) break
                    out.write(buf, 0, n)
                    if (out.size() > limit) break
                }
                return out.toString("UTF-8")
            }
        } finally {
            c.disconnect()
        }
    }
}
