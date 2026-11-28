package com.shobmilbe.sms;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.Iterator;

/** Everything the app remembers, in one small file on the phone. */
final class Store {
    private Store() {}

    static SharedPreferences p(Context c) {
        return c.getApplicationContext().getSharedPreferences("gw", Context.MODE_PRIVATE);
    }

    static String site(Context c) { return p(c).getString("site", "https://shobmilbe.com"); }
    static String key(Context c) { return p(c).getString("key", ""); }
    static boolean paired(Context c) { return !key(c).isEmpty(); }
    static boolean on(Context c) { return paired(c) && p(c).getBoolean("on", true); }

    static void setPaired(Context c, String site, String key, String shop) {
        p(c).edit().putString("site", site).putString("key", key).putString("shop", shop).putBoolean("on", true).apply();
    }

    static void forget(Context c) {
        p(c).edit().clear().apply();
    }

    // ---- what the screen shows ----
    static synchronized void note(Context c, String what, String value) {
        p(c).edit().putString(what, value).putLong(what + "_at", System.currentTimeMillis()).apply();
    }

    static synchronized void countSent(Context c) {
        SharedPreferences s = p(c);
        String day = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
        int n = day.equals(s.getString("day", "")) ? s.getInt("today", 0) : 0;
        s.edit().putString("day", day).putInt("today", n + 1).putInt("total", s.getInt("total", 0) + 1)
                .putLong("last_sent_at", System.currentTimeMillis()).apply();
    }

    // ---- never send the same SMS twice: what was done with each id (kept 2 days) ----
    static synchronized String done(Context c, String id) {
        return p(c).getString("done_" + id, null);
    }

    static synchronized void setDone(Context c, String id, String state) {
        p(c).edit().putString("done_" + id, state).putLong("doneat_" + id, System.currentTimeMillis()).apply();
    }

    static synchronized void tidy(Context c) {
        SharedPreferences s = p(c);
        SharedPreferences.Editor e = s.edit();
        long old = System.currentTimeMillis() - 2 * 24 * 3600_000L;
        for (String k : s.getAll().keySet()) {
            if (k.startsWith("doneat_") && s.getLong(k, 0) < old) {
                String id = k.substring(7);
                e.remove(k).remove("done_" + id).remove("parts_" + id).remove("ok_" + id);
            }
        }
        e.apply();
    }

    // ---- answers waiting to go back to the shop (kept until the shop has them) ----
    static synchronized void addReport(Context c, String id, String state, String error) {
        try {
            JSONObject all = new JSONObject(p(c).getString("reports", "{}"));
            JSONObject before = all.optJSONObject(id);
            // "delivered" is the best news; never let a later "sent" replace it
            if (before != null && "delivered".equals(before.optString("state")) && !"delivered".equals(state)) return;
            all.put(id, new JSONObject().put("id", id).put("state", state).put("error", error == null ? "" : error));
            p(c).edit().putString("reports", all.toString()).apply();
        } catch (Exception ignored) { }
    }

    static synchronized JSONArray reports(Context c) {
        JSONArray out = new JSONArray();
        try {
            JSONObject all = new JSONObject(p(c).getString("reports", "{}"));
            Iterator<String> it = all.keys();
            while (it.hasNext() && out.length() < 50) out.put(all.getJSONObject(it.next()));
        } catch (Exception ignored) { }
        return out;
    }

    static synchronized void reported(Context c, JSONArray sent) {
        try {
            JSONObject all = new JSONObject(p(c).getString("reports", "{}"));
            for (int i = 0; i < sent.length(); i++) {
                JSONObject r = sent.getJSONObject(i);
                JSONObject now = all.optJSONObject(r.getString("id"));
                // only drop it if nothing newer came in meanwhile
                if (now != null && now.optString("state").equals(r.optString("state"))) all.remove(r.getString("id"));
            }
            p(c).edit().putString("reports", all.toString()).apply();
        } catch (Exception ignored) { }
    }
}
