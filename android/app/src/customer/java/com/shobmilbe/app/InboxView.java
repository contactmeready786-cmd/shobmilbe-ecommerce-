package com.shobmilbe.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/**
 * The ইনবক্স tab: a real Android screen (not a web page).
 * Top: buttons to talk to the shop (WhatsApp / Messenger / call).
 * Below: the shop's offer messages from the last 30 days (Admin → মার্কেটিং → ফোনে অফারের নোটিফিকেশন),
 * newest first; unread ones have a blue dot. Data: /api/app/inbox.
 */
class InboxView extends FrameLayout {

    private final MainActivity act;
    private final ScrollView scroll;
    private final LinearLayout list;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean loading;
    private JSONObject last; // last answer, shown at once next time

    InboxView(MainActivity a) {
        super(a);
        act = a;
        setBackgroundColor(0xFFF5F7FB);
        setClickable(true); // touches never reach the page underneath

        scroll = new ScrollView(a);
        scroll.setFillViewport(true);
        list = new LinearLayout(a);
        list.setOrientation(LinearLayout.VERTICAL);
        list.setPadding(dp(16), dp(8), dp(16), dp(24));
        scroll.addView(list, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        addView(scroll, new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        render(null, false);
    }

    void scrollToTop() { scroll.smoothScrollTo(0, 0); }

    /** Fetch the inbox. visible = the person is looking at it now (then everything counts as read). */
    void load(boolean visible) {
        if (visible && last != null) { render(last, false); markRead(last); }
        else if (visible) render(null, false);
        if (loading) return;
        loading = true;
        new Thread(() -> {
            JSONObject res = null;
            try { res = new JSONObject(get("https://" + MainActivity.HOST + "/api/app/inbox")); } catch (Exception ignored) { }
            final JSONObject r = res;
            ui.post(() -> {
                loading = false;
                if (r != null) last = r;
                boolean showing = getVisibility() == VISIBLE;
                if (showing) {
                    render(last, r == null && last == null);
                    if (last != null) markRead(last);
                } else if (r != null) {
                    act.setInboxUnread(newestId(r) > prefs().getLong("inbox_seen", 0));
                }
            });
        }).start();
    }

    private SharedPreferences prefs() { return act.getSharedPreferences("app", Context.MODE_PRIVATE); }

    private static long newestId(JSONObject r) {
        JSONArray items = r.optJSONArray("items");
        long max = 0;
        if (items != null) for (int i = 0; i < items.length(); i++) max = Math.max(max, items.optJSONObject(i).optLong("id"));
        return max;
    }

    private long seenBefore = -1; // what was already read when this screen opened (keeps the dots for this visit)

    private void markRead(JSONObject r) {
        long newest = newestId(r);
        if (seenBefore < 0) seenBefore = prefs().getLong("inbox_seen", 0);
        if (newest > prefs().getLong("inbox_seen", 0)) prefs().edit().putLong("inbox_seen", newest).apply();
        act.setInboxUnread(false);
    }

    @Override
    protected void onVisibilityChanged(View changedView, int visibility) {
        super.onVisibilityChanged(changedView, visibility);
        if (changedView == this && visibility != VISIBLE) seenBefore = -1;
    }

    // ---------------- drawing ----------------
    private void render(JSONObject r, boolean failed) {
        list.removeAllViews();

        TextView h = text(act.getString(R.string.inbox_title), 22, MainActivity.INK, true);
        h.setPadding(dp(2), dp(10), 0, dp(12));
        list.addView(h);

        if (r == null) {
            if (failed) {
                list.addView(emptyCard(act.getString(R.string.inbox_failed), true));
            } else {
                LinearLayout row = new LinearLayout(act);
                row.setGravity(Gravity.CENTER);
                row.setPadding(0, dp(40), 0, 0);
                ProgressBar pb = new ProgressBar(act);
                row.addView(pb, new LinearLayout.LayoutParams(dp(32), dp(32)));
                list.addView(row);
            }
            return;
        }

        // talk to the shop
        String wa = r.optString("wa"), ms = r.optString("messenger"), phone = r.optString("phone");
        if (!wa.isEmpty() || !ms.isEmpty() || !phone.isEmpty()) {
            list.addView(section(act.getString(R.string.inbox_contact)));
            LinearLayout row = new LinearLayout(act);
            row.setOrientation(LinearLayout.HORIZONTAL);
            if (!wa.isEmpty()) addContact(row, "💬", act.getString(R.string.inbox_whatsapp), 0xFF16A34A, "https://wa.me/" + wa);
            if (!ms.isEmpty()) addContact(row, "✉️", act.getString(R.string.inbox_messenger), 0xFF2563EB, ms);
            if (!phone.isEmpty()) addContact(row, "📞", act.getString(R.string.inbox_call), MainActivity.PRIMARY, "tel:" + phone.replaceAll("[^0-9+]", ""));
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.bottomMargin = dp(18);
            list.addView(row, lp);
        }

        // offer messages
        list.addView(section(act.getString(R.string.inbox_offers)));
        JSONArray items = r.optJSONArray("items");
        if (items == null || items.length() == 0) {
            list.addView(emptyCard(act.getString(R.string.inbox_empty), false));
            return;
        }
        long seen = seenBefore >= 0 ? seenBefore : prefs().getLong("inbox_seen", 0);
        for (int i = 0; i < items.length(); i++) {
            JSONObject o = items.optJSONObject(i);
            if (o != null) list.addView(messageCard(o, o.optLong("id") > seen));
        }
    }

    private void addContact(LinearLayout row, String emoji, String label, int color, String link) {
        LinearLayout b = new LinearLayout(act);
        b.setOrientation(LinearLayout.VERTICAL);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(6), dp(14), dp(6), dp(12));
        b.setBackground(card());
        b.setClickable(true);
        b.setFocusable(true);
        TextView e = text(emoji, 22, color, false);
        e.setGravity(Gravity.CENTER);
        b.addView(e);
        TextView t = text(label, 13, MainActivity.INK, true);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(4), 0, 0);
        b.addView(t);
        b.setOnClickListener(v -> act.openOutside(Uri.parse(link)));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        if (row.getChildCount() > 0) lp.leftMargin = dp(10);
        row.addView(b, lp);
    }

    private View messageCard(JSONObject o, boolean unread) {
        LinearLayout c = new LinearLayout(act);
        c.setOrientation(LinearLayout.HORIZONTAL);
        c.setPadding(dp(14), dp(14), dp(14), dp(14));
        c.setBackground(card());
        c.setClickable(true);
        c.setFocusable(true);

        String img = o.optString("image");
        if (!img.isEmpty()) {
            ImageView iv = new ImageView(act);
            iv.setScaleType(ImageView.ScaleType.CENTER_CROP);
            GradientDrawable ph = new GradientDrawable();
            ph.setColor(0xFFEEF2F7);
            ph.setCornerRadius(dp(10));
            iv.setBackground(ph);
            if (android.os.Build.VERSION.SDK_INT >= 21) iv.setClipToOutline(true);
            LinearLayout.LayoutParams ip = new LinearLayout.LayoutParams(dp(64), dp(64));
            ip.rightMargin = dp(12);
            c.addView(iv, ip);
            loadImage(iv, img);
        }

        LinearLayout col = new LinearLayout(act);
        col.setOrientation(LinearLayout.VERTICAL);
        LinearLayout top = new LinearLayout(act);
        top.setGravity(Gravity.CENTER_VERTICAL);
        if (unread) {
            View dot = new View(act);
            GradientDrawable d = new GradientDrawable();
            d.setShape(GradientDrawable.OVAL);
            d.setColor(MainActivity.PRIMARY);
            dot.setBackground(d);
            LinearLayout.LayoutParams dl = new LinearLayout.LayoutParams(dp(8), dp(8));
            dl.rightMargin = dp(6);
            top.addView(dot, dl);
        }
        TextView title = text(o.optString("title"), 15, MainActivity.INK, true);
        title.setMaxLines(2);
        title.setEllipsize(TextUtils.TruncateAt.END);
        top.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        col.addView(top);

        String body = o.optString("body");
        if (!body.isEmpty()) {
            TextView b = text(body, 13, 0xFF4B5563, false);
            b.setMaxLines(3);
            b.setEllipsize(TextUtils.TruncateAt.END);
            b.setPadding(0, dp(4), 0, 0);
            col.addView(b);
        }
        LinearLayout bottom = new LinearLayout(act);
        bottom.setPadding(0, dp(8), 0, 0);
        TextView when = text(ago(o.optString("at")), 12, MainActivity.MUTED, false);
        bottom.addView(when, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        bottom.addView(text(act.getString(R.string.inbox_open), 12, MainActivity.PRIMARY, true));
        col.addView(bottom);
        c.addView(col, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));

        String url = o.optString("url", "/");
        c.setOnClickListener(v -> {
            String target = url.startsWith("/") ? "https://" + MainActivity.HOST + url : url;
            Uri u = Uri.parse(target);
            if (MainActivity.isShop(u)) act.openFromInbox(target);
            else act.openOutside(u);
        });

        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        c.setLayoutParams(lp);
        return c;
    }

    private View emptyCard(String msg, boolean retry) {
        LinearLayout c = new LinearLayout(act);
        c.setOrientation(LinearLayout.VERTICAL);
        c.setGravity(Gravity.CENTER);
        c.setPadding(dp(20), dp(28), dp(20), dp(28));
        c.setBackground(card());
        TextView e = text(retry ? "📶" : "📭", 36, MainActivity.INK, false);
        e.setGravity(Gravity.CENTER);
        c.addView(e);
        TextView t = text(msg, 14, 0xFF4B5563, false);
        t.setGravity(Gravity.CENTER);
        t.setPadding(0, dp(8), 0, 0);
        c.addView(t);
        if (retry) {
            TextView b = text(act.getString(R.string.inbox_retry), 14, Color.WHITE, true);
            b.setPadding(dp(22), dp(10), dp(22), dp(10));
            GradientDrawable bg = new GradientDrawable();
            bg.setColor(MainActivity.PRIMARY);
            bg.setCornerRadius(dp(10));
            b.setBackground(bg);
            b.setOnClickListener(v -> { render(null, false); load(true); });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            lp.topMargin = dp(16);
            c.addView(b, lp);
        }
        return c;
    }

    private TextView section(String s) {
        TextView t = text(s, 13, MainActivity.MUTED, true);
        t.setPadding(dp(2), 0, 0, dp(8));
        return t;
    }

    private TextView text(String s, int sp, int color, boolean bold) {
        TextView t = new TextView(act);
        t.setText(s);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        if (bold) t.setTypeface(Typeface.DEFAULT_BOLD);
        return t;
    }

    private GradientDrawable card() {
        GradientDrawable g = new GradientDrawable();
        g.setColor(Color.WHITE);
        g.setCornerRadius(dp(14));
        g.setStroke(Math.max(1, dp(1) / 2 + 1), MainActivity.LINE);
        return g;
    }

    private int dp(int v) { return act.dp(v); }

    /** "৩ ঘণ্টা আগে", "২ দিন আগে" … */
    private static String ago(String iso) {
        try {
            SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
            f.setTimeZone(TimeZone.getTimeZone("UTC"));
            Date d = f.parse(iso.length() >= 19 ? iso.substring(0, 19) : iso);
            long min = Math.max(0, (System.currentTimeMillis() - d.getTime()) / 60000);
            if (min < 1) return "এইমাত্র";
            if (min < 60) return MainActivity.bn((int) min) + " মিনিট আগে";
            long hr = min / 60;
            if (hr < 24) return MainActivity.bn((int) hr) + " ঘণ্টা আগে";
            return MainActivity.bn((int) (hr / 24)) + " দিন আগে";
        } catch (Exception e) { return ""; }
    }

    // ---------------- network ----------------
    private void loadImage(ImageView iv, String path) {
        new Thread(() -> {
            Bitmap b = null;
            try {
                String u = path.startsWith("/") ? "https://" + MainActivity.HOST + path : path;
                if (MainActivity.isShop(Uri.parse(u))) {
                    HttpURLConnection c = (HttpURLConnection) new URL(u).openConnection();
                    c.setConnectTimeout(10000);
                    c.setReadTimeout(15000);
                    try (InputStream in = c.getInputStream()) {
                        BitmapFactory.Options o = new BitmapFactory.Options();
                        o.inSampleSize = 2;
                        b = BitmapFactory.decodeStream(in, null, o);
                    } finally { c.disconnect(); }
                }
            } catch (Exception ignored) { }
            final Bitmap bm = b;
            if (bm != null) ui.post(() -> iv.setImageBitmap(bm));
        }).start();
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
            while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); if (out.size() > 300_000) break; }
            return out.toString("UTF-8");
        } finally { c.disconnect(); }
    }
}
