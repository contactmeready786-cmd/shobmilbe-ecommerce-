package com.shobmilbe.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.NetworkType;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.TimeUnit;

/**
 * Offer notifications for the customer app.
 * Every ~30 minutes (only when internet is on) the app asks the shop: "any new offer notification?".
 * When the owner sends one from Admin → Marketing → 🔔 ফোনে অফারের নোটিফিকেশন, it shows on the phone.
 * Free — no Firebase, no SMS.
 */
public class OfferWorker extends Worker {

    private static final String CHANNEL = "offers";

    public OfferWorker(@NonNull Context context, @NonNull WorkerParameters params) { super(context, params); }

    static void schedule(Context ctx) {
        Constraints c = new Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(OfferWorker.class, 30, TimeUnit.MINUTES)
            .setConstraints(c)
            .build();
        WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("offers", ExistingPeriodicWorkPolicy.KEEP, req);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        SharedPreferences p = ctx.getSharedPreferences("app", Context.MODE_PRIVATE);
        long seen = p.getLong("offer_seen", -1);
        try {
            JSONObject res = new JSONObject(get("https://" + MainActivity.HOST + "/api/app/offers?after=" + Math.max(0, seen)));
            long latest = res.optLong("latest", 0);
            if (seen < 0) { // first run after install: start from now, don't show old offers
                p.edit().putLong("offer_seen", latest).apply();
                return Result.success();
            }
            JSONArray items = res.optJSONArray("items");
            if (items != null) {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject o = items.getJSONObject(i);
                    show(ctx, (int) o.optLong("id"), o.optString("title"), o.optString("body"), o.optString("url"), o.optString("image"));
                }
            }
            if (latest > seen) p.edit().putLong("offer_seen", latest).apply();
            return Result.success();
        } catch (Exception e) {
            return Result.success(); // try again next time; never crash
        }
    }

    private static void show(Context ctx, int id, String title, String body, String url, String image) {
        if (title == null || title.isEmpty()) return;
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
                nm.createNotificationChannel(new NotificationChannel(CHANNEL, ctx.getString(R.string.offers_channel), NotificationManager.IMPORTANCE_DEFAULT));
            }
        }
        String target = url;
        if (target == null || target.isEmpty()) target = "/";
        if (target.startsWith("/")) target = "https://" + MainActivity.HOST + target;
        Intent open = new Intent(ctx, MainActivity.class);
        if (MainActivity.isShop(Uri.parse(target))) open.putExtra("url", target);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 23 ? PendingIntent.FLAG_IMMUTABLE : 0);
        PendingIntent pi = PendingIntent.getActivity(ctx, id, open, flags);

        NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setColor(0xFF0866D6)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setContentIntent(pi)
            .setAutoCancel(true);
        Bitmap pic = image == null || image.isEmpty() ? null : picture(image);
        if (pic != null) b.setLargeIcon(pic).setStyle(new NotificationCompat.BigPictureStyle().bigPicture(pic).setSummaryText(body));
        try { NotificationManagerCompat.from(ctx).notify(1000 + id, b.build()); } catch (SecurityException ignored) { }
    }

    private static Bitmap picture(String path) {
        try {
            String u = path.startsWith("/") ? "https://" + MainActivity.HOST + path : path;
            if (!MainActivity.isShop(Uri.parse(u))) return null;
            HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
            c.setConnectTimeout(10000);
            c.setReadTimeout(15000);
            try (InputStream in = c.getInputStream()) { return BitmapFactory.decodeStream(in); }
            finally { c.disconnect(); }
        } catch (Exception e) { return null; }
    }

    private static String get(String u) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
        c.setConnectTimeout(10000);
        c.setReadTimeout(15000);
        c.setRequestProperty("Accept", "application/json");
        c.setRequestProperty("User-Agent", "ShobmilbeApp/" + BuildConfig.VERSION_NAME + " (Android)");
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); if (out.size() > 200_000) break; }
            return out.toString("UTF-8");
        } finally { c.disconnect(); }
    }
}
