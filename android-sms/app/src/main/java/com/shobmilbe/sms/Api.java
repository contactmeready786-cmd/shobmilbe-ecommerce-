package com.shobmilbe.sms;

import android.content.Context;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Talks to the shop: POST <site>/api/smsgw/<action> with JSON. Only https. */
final class Api {
    private Api() {}

    static final class Answer {
        final int status;
        final JSONObject json;
        Answer(int status, JSONObject json) { this.status = status; this.json = json; }
    }

    static Answer post(Context c, String site, String action, JSONObject body, boolean withKey, int readTimeoutMs) throws Exception {
        URL url = new URL(site.replaceAll("/+$", "") + "/api/smsgw/" + action);
        if (!"https".equals(url.getProtocol())) throw new IllegalArgumentException("https only");
        HttpURLConnection h = (HttpURLConnection) url.openConnection();
        try {
            h.setConnectTimeout(15_000);
            h.setReadTimeout(readTimeoutMs);
            h.setRequestMethod("POST");
            h.setDoOutput(true);
            h.setUseCaches(false);
            h.setRequestProperty("Content-Type", "application/json");
            h.setRequestProperty("Accept", "application/json");
            h.setRequestProperty("User-Agent", "ShobmilbeSMS/" + BuildConfigHolder.version(c) + " (Android)");
            if (withKey) h.setRequestProperty("Authorization", "Bearer " + Store.key(c));
            byte[] out = body.toString().getBytes(StandardCharsets.UTF_8);
            h.setFixedLengthStreamingMode(out.length);
            try (OutputStream o = h.getOutputStream()) { o.write(out); }
            int status = h.getResponseCode();
            InputStream in = status >= 400 ? h.getErrorStream() : h.getInputStream();
            String text = "";
            if (in != null) {
                try (InputStream i = in) {
                    ByteArrayOutputStream buf = new ByteArrayOutputStream();
                    byte[] b = new byte[8192];
                    int n;
                    while ((n = i.read(b)) > 0 && buf.size() < 512 * 1024) buf.write(b, 0, n);
                    text = buf.toString("UTF-8");
                }
            }
            JSONObject j;
            try { j = new JSONObject(text); } catch (Exception e) { j = new JSONObject(); }
            return new Answer(status, j);
        } finally {
            h.disconnect();
        }
    }
}
