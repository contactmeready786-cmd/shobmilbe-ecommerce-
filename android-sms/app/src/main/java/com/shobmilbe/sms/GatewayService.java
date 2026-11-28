package com.shobmilbe.sms;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.os.BatteryManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Always running (with a small notification) while switched on: asks the shop for SMS, sends them, reports back.
 * The shop holds each ask open up to 25 seconds, so a code goes out within a second or two of the customer asking.
 * No internet / shop busy → waits a little longer each time (5 s … 60 s) and tries again; never gives up.
 */
public class GatewayService extends Service {
    private static final String CH = "gw";
    private static final int NOTE = 1;
    static volatile boolean running;

    private Thread worker;
    private PowerManager.WakeLock lock;

    static void start(Context c) {
        if (!Store.on(c)) return;
        Intent i = new Intent(c, GatewayService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i); else c.startService(i);
        } catch (Exception e) {
            Store.note(c, "last_error", "অ্যাপ নিজে চালু হতে পারেনি — একবার অ্যাপটা খুলুন");
        }
        watchdog(c);
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, GatewayService.class));
    }

    /** Every 15 minutes the phone checks the app is still running and starts it again if the system stopped it. */
    static void watchdog(Context c) {
        AlarmManager am = (AlarmManager) c.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;
        Intent i = new Intent(c, StartReceiver.class).setAction(StartReceiver.WATCH);
        PendingIntent pi = PendingIntent.getBroadcast(c, 7, i, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME_WAKEUP, SystemClock.elapsedRealtime() + 15 * 60_000L, AlarmManager.INTERVAL_FIFTEEN_MINUTES, pi);
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null) {
            NotificationChannel ch = new NotificationChannel(CH, "SMS পাঠানো চালু", NotificationManager.IMPORTANCE_LOW);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification n = note("চালু আছে — দোকানের SMS এই ফোন থেকে যাবে");
        if (Build.VERSION.SDK_INT >= 34) startForeground(NOTE, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE);
        else startForeground(NOTE, n);
        if (!Store.on(this)) { stopSelf(); return START_NOT_STICKY; }
        if (lock == null) {
            PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "shobmilbe:sms");
            lock.setReferenceCounted(false);
            lock.acquire();
        }
        if (worker == null || !worker.isAlive()) {
            running = true;
            worker = new Thread(this::loop, "sms-gateway");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) { return null; }

    private Notification note(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0));
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH) : new Notification.Builder(this);
        return b.setSmallIcon(R.drawable.ic_stat).setContentTitle("সবমিলবে SMS").setContentText(text)
                .setOngoing(true).setContentIntent(pi).build();
    }

    private void show(String text) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTE, note(text));
    }

    private void loop() {
        long wait = 0;
        String shown = "";
        while (running && Store.on(this)) {
            try {
                if (wait > 0) Thread.sleep(wait);
            } catch (InterruptedException e) { return; }
            String now;
            try {
                Reporter.flush(this);
                JSONObject ask = new JSONObject().put("app", BuildConfigHolder.version(this)).put("model", Build.MANUFACTURER + " " + Build.MODEL);
                battery(ask);
                Api.Answer a = Api.post(this, Store.site(this), "pull", ask, true, 45_000);
                if (a.status == 401) {
                    Store.note(this, "last_error", "দোকান এই ফোনকে চিনছে না — অ্যাডমিন থেকে নতুন কোড নিয়ে আবার যুক্ত করুন");
                    now = "দোকানের সাথে যুক্ত নেই — অ্যাপ খুলুন";
                    wait = 60_000;
                } else if (a.status != 200) {
                    Store.note(this, "last_error", "দোকানের সার্ভার উত্তর দিল: " + a.status);
                    now = "দোকানের সার্ভারে সমস্যা — আবার চেষ্টা করছে";
                    wait = Math.min(60_000, Math.max(5_000, wait * 2));
                } else {
                    Store.note(this, "contact", "ok");
                    wait = 0;
                    JSONArray list = a.json.optJSONArray("messages");
                    if (list != null) for (int i = 0; i < list.length(); i++) handle(list.getJSONObject(i));
                    now = a.json.optBoolean("on", true) ? "চালু আছে — দোকানের SMS এই ফোন থেকে যাবে" : "যুক্ত আছে, কিন্তু অ্যাডমিনে এই অ্যাপ বাছাই করা নেই";
                }
            } catch (InterruptedException e) {
                return;
            } catch (Exception e) {
                Store.note(this, "last_error", "ইন্টারনেট নেই বা দোকানের সাইটে পৌঁছানো যাচ্ছে না");
                now = "ইন্টারনেট নেই — আবার চেষ্টা করছে";
                wait = Math.min(60_000, Math.max(5_000, wait * 2));
            }
            if (!now.equals(shown)) { show(now); shown = now; }
            Store.tidy(this);
        }
    }

    /** One SMS from the shop. Already done before (the shop didn't hear back)? Only tell the shop again. */
    private void handle(JSONObject m) {
        String id = m.optString("id"), phone = m.optString("phone"), body = m.optString("body");
        if (id.isEmpty() || phone.isEmpty() || body.isEmpty()) return;
        String before = Store.done(this, id);
        if (before != null) {
            if (!"sending".equals(before)) { Store.addReport(this, id, before, "failed".equals(before) ? "ফোন পাঠাতে পারেনি" : ""); }
            return;
        }
        Sender.send(this, id, phone, body);
        // a short gap between SMS, so the operator doesn't take the SIM for a spammer
        try { Thread.sleep(1500); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    private void battery(JSONObject ask) {
        try {
            Intent b = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
            if (b == null) return;
            int level = b.getIntExtra(BatteryManager.EXTRA_LEVEL, -1), scale = b.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
            int plugged = b.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0);
            if (level >= 0 && scale > 0) ask.put("battery", Math.round(level * 100f / scale));
            ask.put("charging", plugged != 0);
        } catch (Exception ignored) { }
    }
}
