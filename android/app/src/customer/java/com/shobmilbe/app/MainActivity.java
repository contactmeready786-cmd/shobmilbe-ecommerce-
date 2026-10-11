package com.shobmilbe.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.res.ColorStateList;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.HapticFeedbackConstants;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import java.util.HashSet;
import java.util.Set;

/**
 * সবমিলবে customer app.
 * The shop is shown in the app's OWN built-in browser (not Chrome), so it always opens in
 * mobile view. Around it the app has real Android parts: a bottom bar (হোম, ক্যাটাগরি, কার্ট,
 * ইনবক্স, অ্যাকাউন্ট) with the cart count, pull-down to refresh, and a native inbox screen.
 */
public class MainActivity extends Activity {

    static final String HOST = BuildConfig.SITE_HOST;
    static final String HOME = "https://" + HOST + "/";

    static final int PRIMARY = 0xFF0866D6;
    static final int PRIMARY_SOFT = 0xFFE3EEFC;
    static final int INK = 0xFF14213D;
    static final int MUTED = 0xFF6B7280;
    static final int LINE = 0xFFE5E7EB;

    private static final int REQ_FILE = 11;
    private static final int REQ_CAMERA = 12;
    private static final int REQ_NOTIFY = 13;

    // bottom bar tabs
    static final int TAB_HOME = 0, TAB_CATEGORY = 1, TAB_CART = 2, TAB_INBOX = 3, TAB_ACCOUNT = 4;
    private static final String[] TAB_PATHS = { "/", "/products", "/cart", null, "/account" };
    private static final int[] TAB_ICONS = { R.drawable.ic_tab_home, R.drawable.ic_tab_category, R.drawable.ic_tab_cart, R.drawable.ic_tab_inbox, R.drawable.ic_tab_account };
    private static final int[] TAB_LABELS = { R.string.tab_home, R.string.tab_category, R.string.tab_cart, R.string.tab_inbox, R.string.tab_account };

    private WebView web;
    private SwipeRefreshLayout swipe;
    private ProgressBar bar;
    private View splash;
    private LinearLayout nav;
    private View navLine;
    private final View[] tabIconBox = new View[5];
    private final ImageView[] tabIcon = new ImageView[5];
    private final TextView[] tabLabel = new TextView[5];
    private TextView cartBadge;
    private View inboxDot;
    private InboxView inbox;
    private int currentTab = TAB_HOME;
    private boolean keyboardOpen;
    private boolean navWanted = true;

    private FrameLayout fullScreenBox;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingCamera;
    private String failedUrl;
    private Object backCallback;
    private long lastBackPress;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private boolean resumed;
    private final Runnable cartPoll = new Runnable() {
        @Override public void run() {
            refreshCartCount();
            if (resumed) ui.postDelayed(this, 2500);
        }
    };

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ---- screen: white top/bottom bars with dark icons ----
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT < 35) {
            getWindow().setStatusBarColor(Build.VERSION.SDK_INT >= 23 ? Color.WHITE : PRIMARY);
            getWindow().setNavigationBarColor(Build.VERSION.SDK_INT >= 27 ? Color.WHITE : Color.BLACK);
        }
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);

        // root: [ page area ] over [ bottom bar ]
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);

        FrameLayout page = new FrameLayout(this);
        page.setBackgroundColor(Color.WHITE);
        root.addView(page, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);

        // pull down to refresh, like a normal shopping app
        swipe = new SwipeRefreshLayout(this);
        swipe.setColorSchemeColors(PRIMARY);
        swipe.addView(web, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        swipe.setOnChildScrollUpCallback((parent, child) -> web.getScrollY() > 0);
        swipe.setOnRefreshListener(() -> {
            if (failedUrl != null && (web.getUrl() == null || !web.getUrl().startsWith("http"))) web.loadUrl(failedUrl);
            else web.reload();
        });
        page.addView(swipe, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setVisibility(View.GONE);
        if (Build.VERSION.SDK_INT >= 21) bar.setProgressTintList(ColorStateList.valueOf(PRIMARY));
        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        bp.gravity = Gravity.TOP;
        page.addView(bar, bp);

        inbox = new InboxView(this);
        inbox.setVisibility(View.GONE);
        page.addView(inbox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        navLine = new View(this);
        navLine.setBackgroundColor(LINE);
        root.addView(navLine, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(1) / 2 + 1)));
        nav = buildNav();
        root.addView(nav, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(62)));

        ImageView sp = new ImageView(this);
        sp.setImageResource(R.drawable.splash);
        sp.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        sp.setBackgroundColor(Color.WHITE);
        sp.setPadding(dp(60), dp(60), dp(60), dp(60));
        sp.setClickable(true);
        splash = sp;

        fullScreenBox = new FrameLayout(this);
        fullScreenBox.setBackgroundColor(Color.BLACK);
        fullScreenBox.setVisibility(View.GONE);

        FrameLayout outer = new FrameLayout(this);
        outer.setBackgroundColor(Color.WHITE);
        outer.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        outer.addView(sp, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        outer.addView(fullScreenBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(outer);

        // keep everything clear of the status bar, phone's navigation bar and keyboard;
        // the bottom bar hides while typing (like other apps)
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
            Insets ime = insets.getInsets(WindowInsetsCompat.Type.ime());
            keyboardOpen = ime.bottom > sys.bottom;
            v.setPadding(sys.left, sys.top, sys.right, Math.max(sys.bottom, ime.bottom));
            applyNavVisibility();
            return WindowInsetsCompat.CONSUMED;
        });

        // ---- built-in browser: always phone (mobile) layout ----
        WebSettings w = web.getSettings();
        w.setJavaScriptEnabled(true);
        w.setDomStorageEnabled(true);
        w.setDatabaseEnabled(true);
        w.setMediaPlaybackRequiresUserGesture(false);
        w.setUseWideViewPort(true);          // follow the site's mobile <meta viewport>
        w.setLoadWithOverviewMode(false);
        w.setSupportZoom(false);
        w.setBuiltInZoomControls(false);
        w.setDisplayZoomControls(false);
        w.setTextZoom(100);                  // phone's big-font setting won't break the design
        w.setSupportMultipleWindows(false);  // "open in new tab" links open in the app itself
        w.setJavaScriptCanOpenWindowsAutomatically(false);
        w.setAllowFileAccess(false);
        w.setAllowContentAccess(true);
        w.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        String ua = w.getUserAgentString();
        if (!ua.contains("Mobile")) ua = ua + " Mobile";
        w.setUserAgentString(ua + " ShobmilbeApp/" + BuildConfig.VERSION_NAME);

        // Tell the shop it is inside the app before the page draws, so the site's own cart/account
        // icons (now in the bottom bar) never flash on screen. Only on the shop's own pages.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            Set<String> origins = new HashSet<>();
            origins.add("https://" + HOST);
            origins.add("https://www." + HOST);
            try {
                WebViewCompat.addDocumentStartJavaScript(web, "document.documentElement.classList.add('in-app');", origins);
            } catch (Exception ignored) { }
        }

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new ShopClient());
        web.setWebChromeClient(new ShopChrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> openOutside(Uri.parse(url)));

        setupBack();

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
            currentTab = savedInstanceState.getInt("tab", TAB_HOME);
        }
        if (web.getUrl() == null) web.loadUrl(startUrl(getIntent()));
        if (currentTab == TAB_INBOX) showInbox(); else selectTab(currentTab);

        // hide the splash even if the page is slow
        ui.postDelayed(this::hideSplash, 6000);

        OfferWorker.schedule(this);
        askNotificationPermissionOnce();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && (intent.getData() != null || intent.getStringExtra("url") != null)) {
            hideInbox();
            web.loadUrl(startUrl(intent));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
        outState.putInt("tab", currentTab);
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        resumed = true;
        ui.removeCallbacks(cartPoll);
        ui.post(cartPoll);
        if (inbox != null && inbox.getVisibility() != View.VISIBLE) inbox.load(false); // new offer? show the dot
    }

    @Override
    protected void onPause() {
        resumed = false;
        ui.removeCallbacks(cartPoll);
        web.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        ui.removeCallbacksAndMessages(null);
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }

    /** Which page to open: a shop link, a notification's page, or the home page. */
    private String startUrl(Intent intent) {
        if (intent != null) {
            String extra = intent.getStringExtra("url");
            if (extra != null && isShop(Uri.parse(extra)) && !isAdminPage(Uri.parse(extra))) return extra;
            Uri d = intent.getData();
            if (d != null && isShop(d) && !isAdminPage(d)) return d.toString();
        }
        return HOME;
    }

    /** The admin panel. The customer app NEVER opens it — that is only for the separate admin app. */
    static boolean isAdminPage(Uri u) {
        if (u == null || !isShop(u)) return false;
        String p = u.getPath() == null ? "" : u.getPath().toLowerCase();
        while (p.startsWith("//")) p = p.substring(1);
        return p.equals("/admin") || p.startsWith("/admin/") || p.startsWith("/admin%") || p.startsWith("/admin.");
    }

    static boolean isShop(Uri u) {
        if (u == null || u.getHost() == null) return false;
        String s = u.getScheme();
        if (!"https".equalsIgnoreCase(s) && !"http".equalsIgnoreCase(s)) return false;
        String h = u.getHost().toLowerCase();
        return h.equals(HOST) || h.equals("www." + HOST);
    }

    // ---------------- bottom bar ----------------
    private LinearLayout buildNav() {
        LinearLayout n = new LinearLayout(this);
        n.setOrientation(LinearLayout.HORIZONTAL);
        n.setBackgroundColor(Color.WHITE);
        n.setGravity(Gravity.CENTER_VERTICAL);
        if (Build.VERSION.SDK_INT >= 21) n.setElevation(dp(8));
        for (int i = 0; i < 5; i++) {
            final int tab = i;
            LinearLayout item = new LinearLayout(this);
            item.setOrientation(LinearLayout.VERTICAL);
            item.setGravity(Gravity.CENTER);
            item.setClickable(true);
            item.setFocusable(true);
            TypedValue tv = new TypedValue();
            if (getTheme().resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true)) item.setBackgroundResource(tv.resourceId);
            item.setContentDescription(getString(TAB_LABELS[i]));

            FrameLayout iconWrap = new FrameLayout(this);
            FrameLayout pill = new FrameLayout(this); // soft highlight behind the selected icon
            ImageView icon = new ImageView(this);
            icon.setImageResource(TAB_ICONS[i]);
            FrameLayout.LayoutParams ip = new FrameLayout.LayoutParams(dp(24), dp(24));
            ip.gravity = Gravity.CENTER;
            pill.addView(icon, ip);
            FrameLayout.LayoutParams pp = new FrameLayout.LayoutParams(dp(56), dp(30));
            pp.gravity = Gravity.CENTER;
            iconWrap.addView(pill, pp);

            if (i == TAB_CART) {
                cartBadge = new TextView(this);
                cartBadge.setTextColor(Color.WHITE);
                cartBadge.setTextSize(TypedValue.COMPLEX_UNIT_SP, 10);
                cartBadge.setTypeface(Typeface.DEFAULT_BOLD);
                cartBadge.setGravity(Gravity.CENTER);
                cartBadge.setPadding(dp(4), 0, dp(4), 0);
                cartBadge.setMinWidth(dp(17));
                GradientDrawable bg = new GradientDrawable();
                bg.setColor(0xFFE11D48);
                bg.setCornerRadius(dp(9));
                bg.setStroke(dp(2), Color.WHITE);
                cartBadge.setBackground(bg);
                cartBadge.setVisibility(View.GONE);
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(18));
                lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                lp.leftMargin = dp(20);
                lp.topMargin = -dp(3);
                iconWrap.addView(cartBadge, lp);
            }
            if (i == TAB_INBOX) {
                inboxDot = new View(this);
                GradientDrawable dot = new GradientDrawable();
                dot.setShape(GradientDrawable.OVAL);
                dot.setColor(0xFFE11D48);
                dot.setStroke(dp(2), Color.WHITE);
                inboxDot.setBackground(dot);
                inboxDot.setVisibility(View.GONE);
                FrameLayout.LayoutParams lp = new FrameLayout.LayoutParams(dp(11), dp(11));
                lp.gravity = Gravity.TOP | Gravity.CENTER_HORIZONTAL;
                lp.leftMargin = dp(14);
                lp.topMargin = dp(1);
                iconWrap.addView(inboxDot, lp);
            }
            item.addView(iconWrap, new LinearLayout.LayoutParams(dp(56), dp(32)));

            TextView label = new TextView(this);
            label.setText(TAB_LABELS[i]);
            label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
            label.setGravity(Gravity.CENTER);
            label.setSingleLine(true);
            LinearLayout.LayoutParams llp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
            llp.topMargin = dp(2);
            item.addView(label, llp);

            tabIconBox[i] = pill;
            tabIcon[i] = icon;
            tabLabel[i] = label;
            item.setOnClickListener(v -> {
                v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);
                onTab(tab);
            });
            n.addView(item, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.MATCH_PARENT, 1f));
        }
        return n;
    }

    private void onTab(int tab) {
        if (tab == TAB_INBOX) {
            if (inbox.getVisibility() == View.VISIBLE) inbox.scrollToTop(); else showInbox();
            return;
        }
        boolean wasInbox = inbox.getVisibility() == View.VISIBLE;
        hideInbox();
        String now = web.getUrl();
        Uri u = now == null ? null : Uri.parse(now);
        String path = u != null && isShop(u) ? (u.getPath() == null || u.getPath().isEmpty() ? "/" : u.getPath()) : null;
        if (!wasInbox && tab == currentTab && path != null && path.equals(TAB_PATHS[tab]) && (u.getQuery() == null)) {
            // tapping the tab you are on: back to the top of the page
            web.evaluateJavascript("window.scrollTo({top:0,behavior:'smooth'})", null);
            return;
        }
        if (wasInbox && tab == tabForUrl(now) && path != null) { selectTab(tab); return; } // just return to the page
        selectTab(tab);
        web.loadUrl("https://" + HOST + TAB_PATHS[tab]);
    }

    private void selectTab(int tab) {
        currentTab = tab;
        for (int i = 0; i < 5; i++) {
            boolean on = i == tab;
            int c = on ? PRIMARY : MUTED;
            if (Build.VERSION.SDK_INT >= 21) tabIcon[i].setImageTintList(ColorStateList.valueOf(c));
            else tabIcon[i].setColorFilter(c);
            tabLabel[i].setTextColor(c);
            tabLabel[i].setTypeface(on ? Typeface.DEFAULT_BOLD : Typeface.DEFAULT);
            if (on) {
                GradientDrawable pill = new GradientDrawable();
                pill.setColor(PRIMARY_SOFT);
                pill.setCornerRadius(dp(15));
                tabIconBox[i].setBackground(pill);
            } else {
                tabIconBox[i].setBackground(null);
            }
        }
    }

    /** Which tab a page belongs to. */
    static int tabForUrl(String url) {
        if (url == null) return TAB_HOME;
        Uri u = Uri.parse(url);
        if (!isShop(u)) return -1;
        String p = u.getPath() == null ? "/" : u.getPath();
        if (p.startsWith("/cart") || p.startsWith("/checkout")) return TAB_CART;
        if (p.startsWith("/account") || p.startsWith("/track") || p.startsWith("/order") || p.startsWith("/wishlist") || p.startsWith("/complaint")) return TAB_ACCOUNT;
        if (p.startsWith("/products") || p.startsWith("/brand") || p.startsWith("/kits") || p.startsWith("/compare")) return TAB_CATEGORY;
        return TAB_HOME;
    }

    /** Pages where a shopping app hides its bottom bar: checkout and payment. */
    private static boolean hidesNav(String url) {
        if (url == null) return false;
        Uri u = Uri.parse(url);
        if (!"https".equalsIgnoreCase(u.getScheme()) && !"http".equalsIgnoreCase(u.getScheme())) return false;
        if (!isShop(u)) return true; // bKash / card payment pages
        String p = u.getPath() == null ? "/" : u.getPath();
        return p.startsWith("/checkout") || p.startsWith("/pay/");
    }

    private void onPageChanged(String url) {
        if (url == null || !url.startsWith("http")) return;
        navWanted = !hidesNav(url);
        applyNavVisibility();
        int t = tabForUrl(url);
        if (t >= 0 && inbox.getVisibility() != View.VISIBLE) selectTab(t);
    }

    private void applyNavVisibility() {
        boolean show = navWanted && !keyboardOpen;
        int v = show ? View.VISIBLE : View.GONE;
        if (nav.getVisibility() != v) { nav.setVisibility(v); navLine.setVisibility(v); }
    }

    private void showInbox() {
        inbox.setVisibility(View.VISIBLE);
        swipe.setEnabled(false);
        navWanted = true;
        applyNavVisibility();
        selectTab(TAB_INBOX);
        inbox.load(true);
    }

    private void hideInbox() {
        if (inbox.getVisibility() != View.VISIBLE) return;
        inbox.setVisibility(View.GONE);
        swipe.setEnabled(true);
        onPageChanged(web.getUrl());
    }

    void setInboxUnread(boolean unread) {
        if (inboxDot != null) inboxDot.setVisibility(unread ? View.VISIBLE : View.GONE);
    }

    /** Called from the inbox: open a page of the shop. */
    void openFromInbox(String url) {
        hideInbox();
        web.loadUrl(url);
    }

    private void refreshCartCount() {
        String u = web.getUrl();
        if (u == null || !isShop(Uri.parse(u))) return;
        web.evaluateJavascript("(function(){try{var c=JSON.parse(localStorage.getItem('sm_cart')||'{}'),n=0;for(var k in c)n+=(+c[k]||0);return n}catch(e){return 0}})()", v -> {
            int n = 0;
            try { n = (int) Double.parseDouble(v == null ? "0" : v.replace("\"", "")); } catch (Exception ignored) { }
            if (n > 0) {
                cartBadge.setText(n > 99 ? "99+" : bn(n));
                cartBadge.setVisibility(View.VISIBLE);
            } else {
                cartBadge.setVisibility(View.GONE);
            }
        });
    }

    static String bn(int n) {
        String s = String.valueOf(n);
        StringBuilder b = new StringBuilder();
        for (char c : s.toCharArray()) b.append(c >= '0' && c <= '9' ? (char) ('০' + (c - '0')) : c);
        return b.toString();
    }

    // ---------------- back button ----------------
    private void goBack() {
        if (fullScreenView != null) { exitFullScreen(); return; }
        if (inbox.getVisibility() == View.VISIBLE) { hideInbox(); return; }
        if (web.canGoBack()) { web.goBack(); return; }
        String u = web.getUrl();
        if (u != null && isShop(Uri.parse(u)) && tabForUrl(u) != TAB_HOME) { // from another tab, back goes home first
            selectTab(TAB_HOME);
            web.loadUrl(HOME);
            return;
        }
        long now = System.currentTimeMillis();
        if (now - lastBackPress < 2000) { finish(); return; }
        lastBackPress = now;
        toast(R.string.press_back_again);
    }

    private void setupBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            android.window.OnBackInvokedCallback cb = this::goBack;
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb);
            backCallback = cb;
        }
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { goBack(); }

    // ---------------- links ----------------
    /** Links that belong to other apps (WhatsApp, phone, Facebook…) open in those apps. */
    static boolean belongsToAnotherApp(Uri u) {
        String h = u.getHost() == null ? "" : u.getHost().toLowerCase();
        String[] apps = { "wa.me", "api.whatsapp.com", "chat.whatsapp.com", "web.whatsapp.com", "whatsapp.com",
            "facebook.com", "m.facebook.com", "www.facebook.com", "fb.com", "fb.me", "m.me", "messenger.com",
            "instagram.com", "www.instagram.com", "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
            "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "t.me", "telegram.me",
            "play.google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl", "twitter.com", "x.com", "linkedin.com", "www.linkedin.com" };
        for (String a : apps) if (h.equals(a)) return true;
        return h.endsWith(".facebook.com") || h.endsWith(".whatsapp.com");
    }

    private boolean handleUrl(Uri u) {
        String scheme = u.getScheme() == null ? "" : u.getScheme().toLowerCase();
        if ("shobmilbe".equals(scheme)) { // "আবার চেষ্টা করুন" on the no-internet page
            web.loadUrl(failedUrl != null ? failedUrl : HOME);
            return true;
        }
        if (scheme.equals("http") || scheme.equals("https")) {
            if (isAdminPage(u)) { blockAdmin(); return true; } // never in the customer app
            if (isShop(u)) return false;            // shop pages stay inside
            if (belongsToAnotherApp(u)) { openOutside(u); return true; }
            return false;                            // payment pages (bKash, SSLCommerz…) stay inside so the order finishes
        }
        if (scheme.equals("intent")) {
            try {
                Intent i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME);
                i.addCategory(Intent.CATEGORY_BROWSABLE);
                i.setComponent(null);
                i.setSelector(null);
                try { startActivity(i); }
                catch (ActivityNotFoundException e) {
                    String fb = i.getStringExtra("browser_fallback_url");
                    if (fb != null) web.loadUrl(fb);
                    else toast(R.string.open_failed);
                }
            } catch (Exception e) { toast(R.string.open_failed); }
            return true;
        }
        // tel:, mailto:, whatsapp:, sms:, fb: …
        openOutside(u);
        return true;
    }

    void openOutside(Uri u) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, u);
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
        } catch (Exception e) { toast(R.string.open_failed); }
    }

    private class ShopClient extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleUrl(request.getUrl());
        }

        @SuppressWarnings("deprecation")
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            return handleUrl(Uri.parse(url));
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            if (url != null && isAdminPage(Uri.parse(url))) { view.stopLoading(); blockAdmin(); return; }
            if (url != null && url.startsWith("http")) failedUrl = null;
            bar.setProgress(5);
            bar.setVisibility(View.VISIBLE);
            onPageChanged(url);
            // older phones without the early script: mark the page as "in the app" right away
            if (url != null && isShop(Uri.parse(url)) && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                view.evaluateJavascript("document.documentElement.classList.add('in-app')", null);
            }
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            bar.setVisibility(View.GONE);
            swipe.setRefreshing(false);
            if (url != null && url.startsWith("http")) hideSplash();
            onPageChanged(url);
            refreshCartCount();
        }

        @Override
        public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
            if (url != null && isAdminPage(Uri.parse(url))) { view.stopLoading(); blockAdmin(); return; }
            onPageChanged(url); // pages that change address without reloading
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) showOffline(request.getUrl().toString());
        }

        @SuppressWarnings("deprecation")
        @Override
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            if (Build.VERSION.SDK_INT < 23) showOffline(failingUrl);
        }
    }

    /** Someone tried to reach the admin panel from the customer app: back to the shop, and drop the history. */
    private void blockAdmin() {
        ui.post(() -> {
            web.stopLoading();
            selectTab(TAB_HOME);
            web.loadUrl(HOME);
            ui.postDelayed(() -> web.clearHistory(), 1500);
        });
    }

    private void showOffline(String url) {
        failedUrl = url;
        hideSplash();
        swipe.setRefreshing(false);
        String page = "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
            + "<style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:24px;text-align:center;color:#14213d;background:#fff}"
            + "h2{margin:12px 0 6px}p{color:#5b6475;margin:0 0 22px}a{background:#0866D6;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:bold}</style></head>"
            + "<body><div style='font-size:56px'>📶</div><h2>ইন্টারনেট সংযোগ নেই</h2><p>মোবাইল ডাটা বা Wi-Fi চালু আছে কিনা দেখে আবার চেষ্টা করুন।</p>"
            + "<a href='shobmilbe://retry'>🔄 আবার চেষ্টা করুন</a></body></html>";
        web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null);
    }

    private void hideSplash() {
        if (splash != null && splash.getVisibility() == View.VISIBLE) {
            splash.animate().alpha(0f).setDuration(250).withEndAction(() -> splash.setVisibility(View.GONE)).start();
        }
    }

    // ---------------- photos, camera, video ----------------
    private class ShopChrome extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int p) {
            bar.setProgress(Math.max(5, p));
            if (p >= 100) bar.setVisibility(View.GONE);
        }

        // <input type="file"> — e.g. photos for a return request
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            try {
                Intent pick = params.createIntent();
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                startActivityForResult(Intent.createChooser(pick, null), REQ_FILE);
            } catch (Exception e) {
                fileCallback = null;
                return false;
            }
            return true;
        }

        // live camera inside a page (e.g. "ছবি তুলুন")
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean wantsCamera = false;
            for (String r : request.getResources()) if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(r)) wantsCamera = true;
            if (!wantsCamera || !isShop(request.getOrigin())) { request.deny(); return; }
            if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            } else {
                pendingCamera = request;
                requestPermissions(new String[] { Manifest.permission.CAMERA }, REQ_CAMERA);
            }
        }

        // YouTube video full screen
        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            if (fullScreenView != null) { callback.onCustomViewHidden(); return; }
            fullScreenView = view;
            fullScreenCallback = callback;
            fullScreenBox.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            fullScreenBox.setVisibility(View.VISIBLE);
            WindowInsetsControllerCompat c = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
            c.hide(WindowInsetsCompat.Type.systemBars());
            c.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        }

        @Override
        public void onHideCustomView() { exitFullScreen(); }
    }

    private void exitFullScreen() {
        if (fullScreenView == null) return;
        fullScreenBox.removeView(fullScreenView);
        fullScreenBox.setVisibility(View.GONE);
        fullScreenView = null;
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).show(WindowInsetsCompat.Type.systemBars());
        if (fullScreenCallback != null) { fullScreenCallback.onCustomViewHidden(); fullScreenCallback = null; }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != REQ_FILE || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            if (data.getClipData() != null) {
                int n = data.getClipData().getItemCount();
                result = new Uri[n];
                for (int i = 0; i < n; i++) result[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA && pendingCamera != null) {
            boolean ok = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            if (ok) pendingCamera.grant(new String[] { PermissionRequest.RESOURCE_VIDEO_CAPTURE });
            else pendingCamera.deny();
            pendingCamera = null;
        }
    }

    // ---------------- offer notifications ----------------
    private void askNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33) return;
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return;
        SharedPreferences p = getSharedPreferences("app", MODE_PRIVATE);
        if (p.getBoolean("asked_notify", false)) return;
        p.edit().putBoolean("asked_notify", true).apply();
        // ask a few seconds after the shop has opened, not on top of the splash
        ui.postDelayed(() -> {
            if (!isFinishing()) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
        }, 8000);
    }

    // ---------------- helpers ----------------
    int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    void toast(int res) { Toast.makeText(this, res, Toast.LENGTH_SHORT).show(); }
}
