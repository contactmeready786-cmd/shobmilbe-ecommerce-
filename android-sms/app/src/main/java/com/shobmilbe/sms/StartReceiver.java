package com.shobmilbe.sms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Phone switched on, app updated, or the 15-minute check: make sure sending is running. */
public class StartReceiver extends BroadcastReceiver {
    static final String WATCH = "com.shobmilbe.sms.WATCH";

    @Override
    public void onReceive(Context c, Intent intent) {
        if (!Store.on(c)) return;
        if (WATCH.equals(intent.getAction()) && GatewayService.running) return;
        GatewayService.start(c);
    }
}
