package com.shobmilbe.sms;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;

/** One simple screen: connect the phone to the shop (6-digit code), then see that it is running. */
public class MainActivity extends Activity {
    private static final int BLUE = 0xFF1565C0, GREEN = 0xFF2E7D32, RED = 0xFFC62828, AMBER = 0xFFB26A00, GREY = 0xFF555555;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private LinearLayout root;
    private TextView status, detail;
    private final Runnable tick = new Runnable() { @Override public void run() { refresh(); ui.postDelayed(this, 2000); } };

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        setTitle("সবমিলবে SMS");
        draw();
    }

    @Override
    protected void onResume() {
        super.onResume();
        askPermissions();
        if (Store.on(this)) GatewayService.start(this);
        draw();
        ui.post(tick);
    }

    @Override
    protected void onPause() {
        super.onPause();
        ui.removeCallbacks(tick);
    }

    // ---------------------------------------------------------------- screen
    private void draw() {
        ScrollView sv = new ScrollView(this);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(18);
        root.setPadding(pad, pad, pad, pad);
        sv.addView(root);
        setContentView(sv);
        status = null; detail = null;
        if (Store.paired(this)) drawRunning(); else drawPair();
    }

    private void drawPair() {
        root.addView(title("দোকানের সাথে যুক্ত করুন"));
        root.addView(text("১. কম্পিউটারে অ্যাডমিন → মার্কেটিং → কাস্টমারকে SMS খুলুন।\n২. \"ফোন যুক্ত করুন\" চাপুন — ৬ অঙ্কের একটা কোড আসবে।\n৩. কোডটা নিচে লিখে \"যুক্ত করুন\" চাপুন।", GREY));
        final EditText site = input("দোকানের ঠিকানা", Store.site(this), InputType.TYPE_TEXT_VARIATION_URI);
        final EditText code = input("৬ অঙ্কের কোড", "", InputType.TYPE_CLASS_NUMBER);
        root.addView(label("দোকানের ঠিকানা"));
        root.addView(site);
        root.addView(label("কোড"));
        root.addView(code);
        final Button go = button("যুক্ত করুন", BLUE);
        final TextView msg = text("", RED);
        root.addView(go);
        root.addView(msg);
        go.setOnClickListener(v -> {
            String s = site.getText().toString().trim();
            if (!s.startsWith("http")) s = "https://" + s;
            final String url = s.replaceAll("/+$", "");
            final String c = code.getText().toString().replaceAll("\\D", "");
            if (c.length() != 6) { msg.setText("কোডটা ৬ অঙ্কের হবে।"); return; }
            go.setEnabled(false);
            msg.setTextColor(GREY);
            msg.setText("যুক্ত হচ্ছে…");
            new Thread(() -> {
                String err = null;
                try {
                    Api.Answer a = Api.post(this, url, "pair", new JSONObject().put("code", c).put("model", Build.MANUFACTURER + " " + Build.MODEL), false, 20_000);
                    if (a.status == 200 && a.json.optString("key").length() >= 32) {
                        Store.setPaired(this, url, a.json.optString("key"), a.json.optString("shop"));
                    } else if (a.status == 429) err = "অনেকবার ভুল হয়েছে। ১৫ মিনিট পর আবার চেষ্টা করুন।";
                    else err = a.json.optString("error", "যুক্ত হয়নি (" + a.status + ")");
                } catch (Exception e) {
                    err = "দোকানের সাইটে পৌঁছানো যায়নি — ইন্টারনেট আর ঠিকানা দেখুন।";
                }
                final String e2 = err;
                ui.post(() -> {
                    if (e2 == null) { GatewayService.start(this); draw(); askBattery(); }
                    else { go.setEnabled(true); msg.setTextColor(RED); msg.setText(e2); }
                });
            }).start();
        });
    }

    private void drawRunning() {
        SharedPreferences p = Store.p(this);
        String shop = p.getString("shop", "");
        root.addView(title(shop.isEmpty() ? "সবমিলবে SMS" : shop + " — SMS"));
        status = text("", GREEN);
        status.setTextSize(20);
        status.setTypeface(Typeface.DEFAULT_BOLD);
        root.addView(card(status));
        detail = text("", GREY);
        root.addView(detail);

        List<String> fixes = problems();
        if (!fixes.isEmpty()) {
            TextView warn = text("⚠️ ঠিক করতে হবে:\n• " + android.text.TextUtils.join("\n• ", fixes), AMBER);
            root.addView(card(warn));
        }

        final boolean on = Store.on(this);
        Button toggle = button(on ? "⏸ SMS পাঠানো বন্ধ করুন" : "▶ SMS পাঠানো চালু করুন", on ? GREY : GREEN);
        toggle.setOnClickListener(v -> {
            p.edit().putBoolean("on", !on).apply();
            if (!on) GatewayService.start(this); else GatewayService.stop(this);
            draw();
        });
        root.addView(toggle);

        Button perm = button("🔓 অনুমতি দিন", BLUE);
        perm.setOnClickListener(v -> askPermissions());
        if (!hasSms()) root.addView(perm);

        Button bat = button("🔋 ব্যাটারি সেভার থেকে বাদ দিন", BLUE);
        bat.setOnClickListener(v -> askBattery());
        if (!batteryFree()) root.addView(bat);

        if (isXiaomi()) {
            Button auto = button("🚀 Autostart চালু করুন (Xiaomi)", BLUE);
            auto.setOnClickListener(v -> xiaomiAutostart());
            root.addView(auto);
        }

        root.addView(text("\nফোনটা চার্জে আর ইন্টারনেটে রাখুন। অ্যাপটা বন্ধ (swipe করে) করবেন না — উপরের নোটিফিকেশনটা থাকলেই চলছে বুঝবেন।\nপ্রতিটা SMS-এ SIM থেকে সাধারণ SMS-এর টাকা কাটবে।", GREY));

        Button forget = button("এই ফোনকে দোকান থেকে আলাদা করুন", RED);
        forget.setOnClickListener(v -> new AlertDialog.Builder(this).setMessage("আলাদা করলে এই ফোন থেকে আর SMS যাবে না। আবার যুক্ত করতে অ্যাডমিন থেকে নতুন কোড লাগবে।")
                .setPositiveButton("আলাদা করুন", (d, w) -> { GatewayService.stop(this); Store.forget(this); draw(); })
                .setNegativeButton("না", null).show());
        root.addView(forget);
        root.addView(text("সংস্করণ " + BuildConfigHolder.version(this), GREY));
        refresh();
    }

    private void refresh() {
        if (status == null) return;
        SharedPreferences p = Store.p(this);
        long seen = p.getLong("contact_at", 0), errAt = p.getLong("last_error_at", 0);
        String err = p.getString("last_error", "");
        long ago = seen == 0 ? -1 : (System.currentTimeMillis() - seen) / 1000;
        if (!Store.on(this)) { status.setText("⏸ বন্ধ আছে"); status.setTextColor(GREY); }
        else if (ago >= 0 && ago < 90 && !(errAt > seen && !err.isEmpty())) { status.setText("🟢 চালু — দোকানের সাথে যুক্ত"); status.setTextColor(GREEN); }
        else if (!err.isEmpty() && errAt >= seen) { status.setText("🔴 " + err); status.setTextColor(RED); }
        else { status.setText("🟡 দোকানের সাথে যুক্ত হচ্ছে…"); status.setTextColor(AMBER); }
        String day = new java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.US).format(new java.util.Date());
        int today = day.equals(p.getString("day", "")) ? p.getInt("today", 0) : 0;
        long last = p.getLong("last_sent_at", 0);
        detail.setText("আজ পাঠানো: " + today + "টি   ·   মোট: " + p.getInt("total", 0) + "টি"
                + (last > 0 ? "\nশেষ SMS: " + android.text.format.DateFormat.format("d MMM, h:mm a", last) : "")
                + (ago >= 0 ? "\nশেষ সংযোগ: " + (ago < 60 ? "এইমাত্র" : (ago / 60) + " মিনিট আগে") : ""));
    }

    // ---------------------------------------------------------------- what must be right on the phone
    private List<String> problems() {
        List<String> out = new ArrayList<>();
        if (!hasSms()) out.add("SMS পাঠানোর অনুমতি নেই");
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) out.add("নোটিফিকেশনের অনুমতি নেই");
        if (!batteryFree()) out.add("ব্যাটারি সেভার অ্যাপটা বন্ধ করে দিতে পারে");
        return out;
    }

    private boolean hasSms() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    private boolean batteryFree() {
        if (Build.VERSION.SDK_INT < 23) return true;
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        return pm != null && pm.isIgnoringBatteryOptimizations(getPackageName());
    }

    private void askPermissions() {
        if (Build.VERSION.SDK_INT < 23) return;
        List<String> want = new ArrayList<>();
        if (!hasSms()) want.add(Manifest.permission.SEND_SMS);
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) want.add(Manifest.permission.POST_NOTIFICATIONS);
        if (!want.isEmpty()) requestPermissions(want.toArray(new String[0]), 1);
    }

    @Override
    public void onRequestPermissionsResult(int code, String[] perms, int[] res) {
        draw();
        if (Store.on(this)) GatewayService.start(this);
    }

    @android.annotation.SuppressLint("BatteryLife")
    private void askBattery() {
        if (Build.VERSION.SDK_INT < 23 || batteryFree()) return;
        try {
            startActivity(new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getPackageName())));
        } catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)); } catch (Exception ignored) { }
        }
    }

    private boolean isXiaomi() {
        String m = (Build.MANUFACTURER + " " + Build.BRAND).toLowerCase();
        return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco");
    }

    private void xiaomiAutostart() {
        try {
            startActivity(new Intent().setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity")));
        } catch (Exception e) {
            try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()))); } catch (Exception ignored) { }
        }
    }

    // ---------------------------------------------------------------- small pieces
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private TextView title(String t) {
        TextView v = text(t, Color.BLACK);
        v.setTextSize(22);
        v.setTypeface(Typeface.DEFAULT_BOLD);
        v.setPadding(0, 0, 0, dp(10));
        return v;
    }

    private TextView label(String t) {
        TextView v = text(t, GREY);
        v.setPadding(0, dp(10), 0, 0);
        return v;
    }

    private TextView text(String t, int color) {
        TextView v = new TextView(this);
        v.setText(t);
        v.setTextColor(color);
        v.setTextSize(15);
        v.setLineSpacing(0, 1.2f);
        v.setPadding(0, dp(4), 0, dp(4));
        return v;
    }

    private EditText input(String hint, String value, int type) {
        EditText e = new EditText(this);
        e.setHint(hint);
        e.setText(value);
        e.setInputType(type == InputType.TYPE_CLASS_NUMBER ? type : (InputType.TYPE_CLASS_TEXT | type));
        e.setSingleLine(true);
        if (type == InputType.TYPE_CLASS_NUMBER) { e.setTextSize(26); e.setGravity(Gravity.CENTER); e.setLetterSpacing(0.3f); }
        return e;
    }

    private Button button(String t, int color) {
        Button b = new Button(this);
        b.setText(t);
        b.setAllCaps(false);
        b.setTextColor(Color.WHITE);
        b.setTextSize(16);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(10));
        b.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52));
        lp.topMargin = dp(12);
        b.setLayoutParams(lp);
        return b;
    }

    private View card(View inner) {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(dp(14), dp(12), dp(14), dp(12));
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(0xFFF3F6FA);
        bg.setCornerRadius(dp(12));
        box.setBackground(bg);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(8);
        box.setLayoutParams(lp);
        box.addView(inner);
        return box;
    }
}
