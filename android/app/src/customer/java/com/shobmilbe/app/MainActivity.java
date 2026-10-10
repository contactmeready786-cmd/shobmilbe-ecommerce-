package com.shobmilbe.app;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
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
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * সবমিলবে customer app.
 * The shop is shown in the app's OWN built-in browser (not Chrome), so it always opens in
 * mobile view — Chrome's "Desktop site" setting on the phone cannot change it.
 */
public class MainActivity extends Activity {

    static final String HOST = BuildConfig.SITE_HOST;
    static final String HOME = "https://" + HOST + "/";

    private static final int REQ_FILE = 11;
    private static final int REQ_CAMERA = 12;
    private static final int REQ_NOTIFY = 13;

    private WebView web;
    private ProgressBar bar;
    private View splash;
    private FrameLayout fullScreenBox;
    private View fullScreenView;
    private WebChromeClient.CustomViewCallback fullScreenCallback;
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest pendingCamera;
    private String failedUrl;
    private Object backCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // ---- screen: white top/bottom bars with dark icons, page between them ----
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        if (Build.VERSION.SDK_INT < 35) {
            getWindow().setStatusBarColor(Build.VERSION.SDK_INT >= 23 ? Color.WHITE : 0xFF0866D6);
            getWindow().setNavigationBarColor(Build.VERSION.SDK_INT >= 27 ? Color.WHITE : Color.BLACK);
        }
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(true);
        bars.setAppearanceLightNavigationBars(true);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.WHITE);

        web = new WebView(this);
        web.setBackgroundColor(Color.WHITE);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        bar = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        bar.setMax(100);
        bar.setVisibility(View.GONE);
        FrameLayout.LayoutParams bp = new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3));
        bp.gravity = Gravity.TOP;
        root.addView(bar, bp);

        ImageView sp = new ImageView(this);
        sp.setImageResource(R.drawable.splash);
        sp.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        sp.setBackgroundColor(Color.WHITE);
        sp.setPadding(dp(60), dp(60), dp(60), dp(60));
        splash = sp;
        root.addView(sp, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        fullScreenBox = new FrameLayout(this);
        fullScreenBox.setBackgroundColor(Color.BLACK);
        fullScreenBox.setVisibility(View.GONE);

        FrameLayout outer = new FrameLayout(this);
        outer.addView(root, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        outer.addView(fullScreenBox, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(outer);

        // keep the page clear of the status bar, navigation bar and keyboard
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets i = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.ime() | WindowInsetsCompat.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);
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

        CookieManager cm = CookieManager.getInstance();
        cm.setAcceptCookie(true);
        cm.setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new ShopClient());
        web.setWebChromeClient(new ShopChrome());
        web.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) -> openOutside(Uri.parse(url)));

        setupBack();

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        if (web.getUrl() == null) web.loadUrl(startUrl(getIntent()));

        // hide the splash even if the page is slow
        new Handler(Looper.getMainLooper()).postDelayed(this::hideSplash, 6000);

        OfferWorker.schedule(this);
        askNotificationPermissionOnce();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && (intent.getData() != null || intent.getStringExtra("url") != null)) web.loadUrl(startUrl(intent));
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onResume() { super.onResume(); web.onResume(); }

    @Override
    protected void onPause() { web.onPause(); CookieManager.getInstance().flush(); super.onPause(); }

    @Override
    protected void onDestroy() {
        if (web != null) { web.stopLoading(); web.destroy(); }
        super.onDestroy();
    }

    /** Which page to open: a shop link, a notification's page, or the home page. */
    private String startUrl(Intent intent) {
        if (intent != null) {
            String extra = intent.getStringExtra("url");
            if (extra != null && isShop(Uri.parse(extra))) return extra;
            Uri d = intent.getData();
            if (d != null && isShop(d)) return d.toString();
        }
        return HOME;
    }

    static boolean isShop(Uri u) {
        if (u == null || u.getHost() == null) return false;
        String s = u.getScheme();
        if (!"https".equalsIgnoreCase(s) && !"http".equalsIgnoreCase(s)) return false;
        String h = u.getHost().toLowerCase();
        return h.equals(HOST) || h.equals("www." + HOST);
    }

    // ---------------- back button ----------------
    private void goBack() {
        if (fullScreenView != null) { exitFullScreen(); return; }
        if (web.canGoBack()) web.goBack();
        else finish();
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
    private static boolean belongsToAnotherApp(Uri u) {
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

    private void openOutside(Uri u) {
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
            bar.setProgress(5);
            bar.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            bar.setVisibility(View.GONE);
            if (url != null && url.startsWith("http")) hideSplash();
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

    private void showOffline(String url) {
        failedUrl = url;
        hideSplash();
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
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            if (!isFinishing()) requestPermissions(new String[] { Manifest.permission.POST_NOTIFICATIONS }, REQ_NOTIFY);
        }, 8000);
    }

    // ---------------- helpers ----------------
    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }

    private void toast(int res) { Toast.makeText(this, res, Toast.LENGTH_SHORT).show(); }
}
