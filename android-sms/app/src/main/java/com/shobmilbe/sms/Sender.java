package com.shobmilbe.sms;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.telephony.SmsManager;

import java.util.ArrayList;

/** Sends one SMS from this phone's SIM. The result comes back to SmsResultReceiver. */
final class Sender {
    private Sender() {}

    private static int req = (int) (System.currentTimeMillis() & 0xFFFFF);

    @SuppressWarnings("deprecation")
    static SmsManager manager(Context c) {
        if (Build.VERSION.SDK_INT >= 31) {
            SmsManager m = c.getSystemService(SmsManager.class);
            if (m != null) return m;
        }
        return SmsManager.getDefault();
    }

    /** true = handed to the SIM (result follows), false = it could not even start (already reported as failed). */
    static boolean send(Context c, String id, String phone, String body) {
        try {
            SmsManager m = manager(c);
            ArrayList<String> parts = m.divideMessage(body);
            int n = parts.size();
            Store.p(c).edit().putInt("parts_" + id, n).putInt("ok_" + id, 0).apply();
            ArrayList<PendingIntent> sent = new ArrayList<>();
            ArrayList<PendingIntent> delivered = new ArrayList<>();
            for (int i = 0; i < n; i++) {
                sent.add(pi(c, SmsResultReceiver.SENT, id));
                // "delivered" is asked for the last part only: when it arrives the whole SMS is there
                delivered.add(i == n - 1 ? pi(c, SmsResultReceiver.DELIVERED, id) : null);
            }
            Store.setDone(c, id, "sending");
            if (n == 1) m.sendTextMessage(phone, null, body, sent.get(0), delivered.get(0));
            else m.sendMultipartTextMessage(phone, null, parts, sent, delivered);
            return true;
        } catch (Exception e) {
            String why = e instanceof SecurityException ? "SMS পাঠানোর অনুমতি নেই — অ্যাপ খুলে অনুমতি দিন" : "ফোন পাঠাতে পারেনি: " + e.getClass().getSimpleName();
            Store.setDone(c, id, "failed");
            Store.addReport(c, id, "failed", why);
            Store.note(c, "last_error", why);
            return false;
        }
    }

    private static PendingIntent pi(Context c, String action, String id) {
        Intent i = new Intent(c, SmsResultReceiver.class).setAction(action).putExtra("id", id);
        int flags = PendingIntent.FLAG_ONE_SHOT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        synchronized (Sender.class) { req += 1; return PendingIntent.getBroadcast(c, req, i, flags); }
    }
}
