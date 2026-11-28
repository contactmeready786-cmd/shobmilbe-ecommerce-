package com.shobmilbe.sms;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.telephony.SmsManager;

/** What the SIM did with an SMS: sent (every part), failed (why), delivered (the customer's phone has it). */
public class SmsResultReceiver extends BroadcastReceiver {
    static final String SENT = "com.shobmilbe.sms.SENT";
    static final String DELIVERED = "com.shobmilbe.sms.DELIVERED";

    @Override
    public void onReceive(Context c, Intent intent) {
        String id = intent.getStringExtra("id");
        if (id == null) return;
        int code = getResultCode();
        if (DELIVERED.equals(intent.getAction())) {
            if (code == Activity.RESULT_OK) {
                Store.setDone(c, id, "delivered");
                Store.addReport(c, id, "delivered", "");
                Reporter.flushSoon(c);
            }
            return;
        }
        synchronized (SmsResultReceiver.class) {
            String now = Store.done(c, id);
            if ("failed".equals(now) || "sent".equals(now) || "delivered".equals(now)) return;
            if (code != Activity.RESULT_OK) {
                String why = reason(code);
                Store.setDone(c, id, "failed");
                Store.addReport(c, id, "failed", why);
                Store.note(c, "last_error", why);
            } else {
                SharedPreferences p = Store.p(c);
                int ok = p.getInt("ok_" + id, 0) + 1;
                p.edit().putInt("ok_" + id, ok).apply();
                if (ok < p.getInt("parts_" + id, 1)) return;
                Store.setDone(c, id, "sent");
                Store.addReport(c, id, "sent", "");
                Store.countSent(c);
                Store.note(c, "last_error", "");
            }
        }
        Reporter.flushSoon(c);
    }

    static String reason(int code) {
        switch (code) {
            case SmsManager.RESULT_ERROR_NO_SERVICE: return "নেটওয়ার্ক নেই (SIM-এ সিগন্যাল নেই)";
            case SmsManager.RESULT_ERROR_RADIO_OFF: return "ফোনের নেটওয়ার্ক বন্ধ (Airplane mode?)";
            case SmsManager.RESULT_ERROR_NULL_PDU: return "SMS বানানো যায়নি";
            case SmsManager.RESULT_ERROR_LIMIT_EXCEEDED: return "ফোন একসাথে বেশি SMS পাঠাতে দিচ্ছে না";
            case SmsManager.RESULT_ERROR_SHORT_CODE_NOT_ALLOWED:
            case SmsManager.RESULT_ERROR_SHORT_CODE_NEVER_ALLOWED: return "এই নম্বরে SMS পাঠানো ফোন আটকে দিয়েছে";
            default: return "SIM পাঠাতে পারেনি (ব্যালান্স / SMS প্যাক / নেটওয়ার্ক দেখুন) [" + code + "]";
        }
    }
}
