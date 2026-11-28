package com.shobmilbe.sms;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Sends the phone's answers (sent / failed / delivered) back to the shop — at once, and again until it has them. */
final class Reporter {
    private Reporter() {}

    private static final ExecutorService one = Executors.newSingleThreadExecutor();

    static void flushSoon(Context c) {
        final Context app = c.getApplicationContext();
        one.execute(() -> flush(app));
    }

    /** true = nothing left to tell the shop */
    static boolean flush(Context c) {
        if (!Store.paired(c)) return true;
        JSONArray list = Store.reports(c);
        if (list.length() == 0) return true;
        try {
            Api.Answer a = Api.post(c, Store.site(c), "report", new JSONObject().put("results", list), true, 20_000);
            if (a.status == 200) { Store.reported(c, list); return Store.reports(c).length() == 0; }
        } catch (Exception ignored) { }
        return false;
    }
}
