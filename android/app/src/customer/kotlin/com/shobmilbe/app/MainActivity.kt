package com.shobmilbe.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.ViewGroup.LayoutParams.WRAP_CONTENT
import android.view.WindowManager
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import android.window.OnBackInvokedCallback
import android.window.OnBackInvokedDispatcher
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.swiperefreshlayout.widget.SwipeRefreshLayout
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * সবমিলবে customer app.
 * The shop is shown in the app's OWN built-in browser (not Chrome), so it always opens in
 * mobile view. Around it the app has real Android parts: a bottom bar (হোম, ক্যাটাগরি, কার্ট,
 * ইনবক্স, অ্যাকাউন্ট) with the cart count, pull-down to refresh, and a native inbox screen.
 */
class MainActivity : Activity() {

    companion object {
        const val HOST: String = BuildConfig.SITE_HOST
        const val HOME = "https://$HOST/"

        const val PRIMARY = 0xFF0866D6.toInt()
        const val PRIMARY_SOFT = 0xFFE3EEFC.toInt()
        const val INK = 0xFF14213D.toInt()
        const val MUTED = 0xFF6B7280.toInt()
        const val LINE = 0xFFE5E7EB.toInt()

        private const val REQ_FILE = 11
        private const val REQ_CAMERA = 12
        private const val REQ_NOTIFY = 13

        // bottom bar tabs
        const val TAB_HOME = 0
        const val TAB_CATEGORY = 1
        const val TAB_CART = 2
        const val TAB_INBOX = 3
        const val TAB_ACCOUNT = 4
        private val TAB_PATHS = arrayOf("/", "/products", "/cart", null, "/account")
        private val TAB_ICONS = intArrayOf(R.drawable.ic_tab_home, R.drawable.ic_tab_category, R.drawable.ic_tab_cart, R.drawable.ic_tab_inbox, R.drawable.ic_tab_account)
        private val TAB_LABELS = intArrayOf(R.string.tab_home, R.string.tab_category, R.string.tab_cart, R.string.tab_inbox, R.string.tab_account)

        /** The admin panel. The customer app NEVER opens it — that is only for the separate admin app. */
        fun isAdminPage(u: Uri?): Boolean {
            if (u == null || !isShop(u)) return false
            var p = u.path?.lowercase() ?: ""
            while (p.startsWith("//")) p = p.substring(1)
            return p == "/admin" || p.startsWith("/admin/") || p.startsWith("/admin%") || p.startsWith("/admin.")
        }

        fun isShop(u: Uri?): Boolean {
            val host = u?.host?.lowercase() ?: return false
            val s = u.scheme
            if (!s.equals("https", ignoreCase = true) && !s.equals("http", ignoreCase = true)) return false
            return host == HOST || host == "www.$HOST"
        }

        /** Which tab a page belongs to (-1: not the shop). */
        fun tabForUrl(url: String?): Int {
            if (url == null) return TAB_HOME
            val u = Uri.parse(url)
            if (!isShop(u)) return -1
            val p = u.path ?: "/"
            return when {
                p.startsWith("/cart") || p.startsWith("/checkout") -> TAB_CART
                listOf("/account", "/track", "/order", "/wishlist", "/complaint").any { p.startsWith(it) } -> TAB_ACCOUNT
                listOf("/products", "/brand", "/kits", "/compare").any { p.startsWith(it) } -> TAB_CATEGORY
                else -> TAB_HOME
            }
        }

        /** Pages where a shopping app hides its bottom bar: checkout and payment. */
        private fun hidesNav(url: String?): Boolean {
            if (url == null) return false
            val u = Uri.parse(url)
            if (!u.scheme.equals("https", true) && !u.scheme.equals("http", true)) return false
            if (!isShop(u)) return true // bKash / card payment pages
            val p = u.path ?: "/"
            return p.startsWith("/checkout") || p.startsWith("/pay/")
        }

        /** 0-9 → ০-৯ */
        fun bn(n: Int): String = n.toString().map { if (it in '0'..'9') '০' + (it - '0') else it }.joinToString("")

        private val OTHER_APPS = setOf(
            "wa.me", "api.whatsapp.com", "chat.whatsapp.com", "web.whatsapp.com", "whatsapp.com",
            "facebook.com", "m.facebook.com", "www.facebook.com", "fb.com", "fb.me", "m.me", "messenger.com",
            "instagram.com", "www.instagram.com", "tiktok.com", "www.tiktok.com", "vm.tiktok.com",
            "youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "t.me", "telegram.me",
            "play.google.com", "maps.google.com", "maps.app.goo.gl", "goo.gl", "twitter.com", "x.com", "linkedin.com", "www.linkedin.com",
        )

        /** Links that belong to other apps (WhatsApp, phone, Facebook…) open in those apps. */
        fun belongsToAnotherApp(u: Uri): Boolean {
            val h = u.host?.lowercase() ?: ""
            return h in OTHER_APPS || h.endsWith(".facebook.com") || h.endsWith(".whatsapp.com")
        }

        /** The cart in the page's storage (the site keeps it in localStorage "sm_cart"). */
        private const val CART_COUNT_JS =
            "(()=>{try{const c=JSON.parse(localStorage.getItem('sm_cart')||'{}');return Object.values(c).reduce((n,v)=>n+(+v||0),0)}catch{return 0}})()"
    }

    private lateinit var web: WebView
    private lateinit var swipe: SwipeRefreshLayout
    private lateinit var bar: ProgressBar
    private lateinit var splash: View
    private lateinit var nav: LinearLayout
    private lateinit var navLine: View
    private lateinit var inbox: InboxView
    private lateinit var fullScreenBox: FrameLayout
    private val tabIconBox = arrayOfNulls<View>(5)
    private val tabIcon = arrayOfNulls<ImageView>(5)
    private val tabLabel = arrayOfNulls<TextView>(5)
    private var cartBadge: TextView? = null
    private var inboxDot: View? = null
    private var currentTab = TAB_HOME
    private var keyboardOpen = false
    private var navWanted = true

    private var fullScreenView: View? = null
    private var fullScreenCallback: WebChromeClient.CustomViewCallback? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null
    private var pendingCamera: PermissionRequest? = null
    private var failedUrl: String? = null
    private var backCallback: Any? = null
    private var lastBackPress = 0L

    private val ui = Handler(Looper.getMainLooper())
    private var resumed = false
    private val cartPoll = object : Runnable {
        override fun run() {
            refreshCartCount()
            if (resumed) ui.postDelayed(this, 2500)
        }
    }

    private val inboxShowing get() = inbox.visibility == View.VISIBLE

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // ---- screen: white top/bottom bars with dark icons ----
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS)
        if (Build.VERSION.SDK_INT < 35) {
            @Suppress("DEPRECATION")
            window.statusBarColor = if (Build.VERSION.SDK_INT >= 23) Color.WHITE else PRIMARY
            @Suppress("DEPRECATION")
            window.navigationBarColor = if (Build.VERSION.SDK_INT >= 27) Color.WHITE else Color.BLACK
        }
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = true
            isAppearanceLightNavigationBars = true
        }

        // root: [ page area ] over [ bottom bar ]
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(Color.WHITE)
        }
        val page = FrameLayout(this).apply { setBackgroundColor(Color.WHITE) }
        root.addView(page, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))

        web = WebView(this).apply {
            setBackgroundColor(Color.WHITE)
            overScrollMode = View.OVER_SCROLL_NEVER
        }

        // pull down to refresh, like a normal shopping app
        swipe = SwipeRefreshLayout(this).apply {
            setColorSchemeColors(PRIMARY)
            addView(web, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            setOnChildScrollUpCallback { _, _ -> web.scrollY > 0 }
            setOnRefreshListener {
                val failed = failedUrl
                if (failed != null && web.url?.startsWith("http") != true) web.loadUrl(failed) else web.reload()
            }
        }
        page.addView(swipe, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        bar = ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            visibility = View.GONE
            progressTintList = ColorStateList.valueOf(PRIMARY)
        }
        page.addView(bar, FrameLayout.LayoutParams(MATCH_PARENT, dp(3)).apply { gravity = Gravity.TOP })

        inbox = InboxView(this).apply { visibility = View.GONE }
        page.addView(inbox, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))

        navLine = View(this).apply { setBackgroundColor(LINE) }
        root.addView(navLine, LinearLayout.LayoutParams(MATCH_PARENT, max(1, dp(1) / 2 + 1)))
        nav = buildNav()
        root.addView(nav, LinearLayout.LayoutParams(MATCH_PARENT, dp(62)))

        splash = ImageView(this).apply {
            setImageResource(R.drawable.splash)
            scaleType = ImageView.ScaleType.CENTER_INSIDE
            setBackgroundColor(Color.WHITE)
            setPadding(dp(60), dp(60), dp(60), dp(60))
            isClickable = true
        }

        fullScreenBox = FrameLayout(this).apply {
            setBackgroundColor(Color.BLACK)
            visibility = View.GONE
        }

        val outer = FrameLayout(this).apply {
            setBackgroundColor(Color.WHITE)
            addView(root, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(splash, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            addView(fullScreenBox, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
        }
        setContentView(outer)

        // keep everything clear of the status bar, phone's navigation bar and keyboard;
        // the bottom bar hides while typing (like other apps)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val sys = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            keyboardOpen = ime.bottom > sys.bottom
            v.setPadding(sys.left, sys.top, sys.right, max(sys.bottom, ime.bottom))
            applyNavVisibility()
            WindowInsetsCompat.CONSUMED
        }

        // ---- built-in browser: always phone (mobile) layout ----
        web.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true          // follow the site's mobile <meta viewport>
            loadWithOverviewMode = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100                  // phone's big-font setting won't break the design
            setSupportMultipleWindows(false) // "open in new tab" links open in the app itself
            javaScriptCanOpenWindowsAutomatically = false
            allowFileAccess = false
            allowContentAccess = true
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            val ua = userAgentString.let { if ("Mobile" in it) it else "$it Mobile" }
            userAgentString = "$ua ShobmilbeApp/${BuildConfig.VERSION_NAME}"
        }

        // Tell the shop it is inside the app before the page draws, so the site's own cart/account
        // icons (now in the bottom bar) never flash on screen. Only on the shop's own pages.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            runCatching {
                WebViewCompat.addDocumentStartJavaScript(web, "document.documentElement.classList.add('in-app');", setOf("https://$HOST", "https://www.$HOST"))
            }
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(web, true)
        }

        web.webViewClient = ShopClient()
        web.webChromeClient = ShopChrome()
        web.setDownloadListener { url, _, _, _, _ -> openOutside(Uri.parse(url)) }

        setupBack()

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState)
            currentTab = savedInstanceState.getInt("tab", TAB_HOME)
        }
        if (web.url == null) web.loadUrl(startUrl(intent))
        if (currentTab == TAB_INBOX) showInbox() else selectTab(currentTab)

        // hide the splash even if the page is slow
        ui.postDelayed(::hideSplash, 6000)

        OfferWorker.schedule(this)
        askNotificationPermissionOnce()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (intent.data != null || intent.getStringExtra("url") != null) {
            hideInbox()
            web.loadUrl(startUrl(intent))
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
        outState.putInt("tab", currentTab)
    }

    override fun onResume() {
        super.onResume()
        web.onResume()
        resumed = true
        ui.removeCallbacks(cartPoll)
        ui.post(cartPoll)
        if (!inboxShowing) inbox.load(false) // new offer? show the dot
    }

    override fun onPause() {
        resumed = false
        ui.removeCallbacks(cartPoll)
        web.onPause()
        CookieManager.getInstance().flush()
        super.onPause()
    }

    override fun onDestroy() {
        ui.removeCallbacksAndMessages(null)
        web.stopLoading()
        web.destroy()
        super.onDestroy()
    }

    /** Which page to open: a shop link, a notification's page, or the home page. */
    private fun startUrl(intent: Intent?): String {
        intent?.getStringExtra("url")?.let { extra ->
            val u = Uri.parse(extra)
            if (isShop(u) && !isAdminPage(u)) return extra
        }
        intent?.data?.let { d -> if (isShop(d) && !isAdminPage(d)) return d.toString() }
        return HOME
    }

    // ---------------- bottom bar ----------------
    private fun buildNav(): LinearLayout {
        val n = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            setBackgroundColor(Color.WHITE)
            gravity = Gravity.CENTER_VERTICAL
            elevation = dp(8).toFloat()
        }
        for (i in 0 until 5) {
            val item = LinearLayout(this).apply {
                orientation = LinearLayout.VERTICAL
                gravity = Gravity.CENTER
                isClickable = true
                isFocusable = true
                val tv = TypedValue()
                if (theme.resolveAttribute(android.R.attr.selectableItemBackgroundBorderless, tv, true)) setBackgroundResource(tv.resourceId)
                contentDescription = getString(TAB_LABELS[i])
            }

            val iconWrap = FrameLayout(this)
            val pill = FrameLayout(this) // soft highlight behind the selected icon
            val icon = ImageView(this).apply { setImageResource(TAB_ICONS[i]) }
            pill.addView(icon, FrameLayout.LayoutParams(dp(24), dp(24)).apply { gravity = Gravity.CENTER })
            iconWrap.addView(pill, FrameLayout.LayoutParams(dp(56), dp(30)).apply { gravity = Gravity.CENTER })

            if (i == TAB_CART) {
                cartBadge = TextView(this).apply {
                    setTextColor(Color.WHITE)
                    setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
                    typeface = Typeface.DEFAULT_BOLD
                    gravity = Gravity.CENTER
                    setPadding(dp(4), 0, dp(4), 0)
                    minWidth = dp(17)
                    background = GradientDrawable().apply {
                        setColor(0xFFE11D48.toInt())
                        cornerRadius = dp(9).toFloat()
                        setStroke(dp(2), Color.WHITE)
                    }
                    visibility = View.GONE
                }.also {
                    iconWrap.addView(it, FrameLayout.LayoutParams(WRAP_CONTENT, dp(18)).apply {
                        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                        leftMargin = dp(20)
                        topMargin = -dp(3)
                    })
                }
            }
            if (i == TAB_INBOX) {
                inboxDot = View(this).apply {
                    background = GradientDrawable().apply {
                        shape = GradientDrawable.OVAL
                        setColor(0xFFE11D48.toInt())
                        setStroke(dp(2), Color.WHITE)
                    }
                    visibility = View.GONE
                }.also {
                    iconWrap.addView(it, FrameLayout.LayoutParams(dp(11), dp(11)).apply {
                        gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                        leftMargin = dp(14)
                        topMargin = dp(1)
                    })
                }
            }
            item.addView(iconWrap, LinearLayout.LayoutParams(dp(56), dp(32)))

            val label = TextView(this).apply {
                setText(TAB_LABELS[i])
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
                gravity = Gravity.CENTER
                isSingleLine = true
            }
            item.addView(label, LinearLayout.LayoutParams(WRAP_CONTENT, WRAP_CONTENT).apply { topMargin = dp(2) })

            tabIconBox[i] = pill
            tabIcon[i] = icon
            tabLabel[i] = label
            item.setOnClickListener { v ->
                v.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
                onTab(i)
            }
            n.addView(item, LinearLayout.LayoutParams(0, MATCH_PARENT, 1f))
        }
        return n
    }

    private fun onTab(tab: Int) {
        if (tab == TAB_INBOX) {
            if (inboxShowing) inbox.scrollToTop() else showInbox()
            return
        }
        val wasInbox = inboxShowing
        hideInbox()
        val now = web.url
        val u = now?.let(Uri::parse)
        val path = if (u != null && isShop(u)) (u.path?.takeIf { it.isNotEmpty() } ?: "/") else null
        if (!wasInbox && tab == currentTab && path != null && path == TAB_PATHS[tab] && u?.query == null) {
            // tapping the tab you are on: back to the top of the page
            web.evaluateJavascript("window.scrollTo({top:0,behavior:'smooth'})", null)
            return
        }
        if (wasInbox && tab == tabForUrl(now) && path != null) { selectTab(tab); return } // just return to the page
        selectTab(tab)
        web.loadUrl("https://$HOST${TAB_PATHS[tab]}")
    }

    private fun selectTab(tab: Int) {
        currentTab = tab
        for (i in 0 until 5) {
            val on = i == tab
            val c = if (on) PRIMARY else MUTED
            tabIcon[i]?.imageTintList = ColorStateList.valueOf(c)
            tabLabel[i]?.apply {
                setTextColor(c)
                typeface = if (on) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            }
            tabIconBox[i]?.background = if (on) GradientDrawable().apply {
                setColor(PRIMARY_SOFT)
                cornerRadius = dp(15).toFloat()
            } else null
        }
    }

    private fun onPageChanged(url: String?) {
        if (url == null || !url.startsWith("http")) return
        navWanted = !hidesNav(url)
        applyNavVisibility()
        val t = tabForUrl(url)
        if (t >= 0 && !inboxShowing) selectTab(t)
    }

    private fun applyNavVisibility() {
        val v = if (navWanted && !keyboardOpen) View.VISIBLE else View.GONE
        if (nav.visibility != v) {
            nav.visibility = v
            navLine.visibility = v
        }
    }

    private fun showInbox() {
        inbox.visibility = View.VISIBLE
        swipe.isEnabled = false
        navWanted = true
        applyNavVisibility()
        selectTab(TAB_INBOX)
        inbox.load(true)
    }

    private fun hideInbox() {
        if (!inboxShowing) return
        inbox.visibility = View.GONE
        swipe.isEnabled = true
        onPageChanged(web.url)
    }

    fun setInboxUnread(unread: Boolean) {
        inboxDot?.visibility = if (unread) View.VISIBLE else View.GONE
    }

    /** Called from the inbox: open a page of the shop. */
    fun openFromInbox(url: String) {
        hideInbox()
        web.loadUrl(url)
    }

    private fun refreshCartCount() {
        val u = web.url ?: return
        if (!isShop(Uri.parse(u))) return
        web.evaluateJavascript(CART_COUNT_JS) { v ->
            val n = v?.replace("\"", "")?.toDoubleOrNull()?.toInt() ?: 0
            cartBadge?.apply {
                if (n > 0) {
                    text = if (n > 99) "99+" else bn(n)
                    visibility = View.VISIBLE
                } else visibility = View.GONE
            }
        }
    }

    // ---------------- back button ----------------
    private fun goBack() {
        if (fullScreenView != null) { exitFullScreen(); return }
        if (inboxShowing) { hideInbox(); return }
        if (web.canGoBack()) { web.goBack(); return }
        val u = web.url
        if (u != null && isShop(Uri.parse(u)) && tabForUrl(u) != TAB_HOME) { // from another tab, back goes home first
            selectTab(TAB_HOME)
            web.loadUrl(HOME)
            return
        }
        val now = System.currentTimeMillis()
        if (now - lastBackPress < 2000) { finish(); return }
        lastBackPress = now
        toast(R.string.press_back_again)
    }

    private fun setupBack() {
        if (Build.VERSION.SDK_INT >= 33) {
            val cb = OnBackInvokedCallback { goBack() }
            onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, cb)
            backCallback = cb
        }
    }

    @Deprecated("Android 13+ uses the OnBackInvokedCallback above")
    @Suppress("DEPRECATION")
    override fun onBackPressed() = goBack()

    // ---------------- links ----------------
    private fun handleUrl(u: Uri): Boolean {
        val scheme = u.scheme?.lowercase() ?: ""
        when {
            scheme == "shobmilbe" -> { // "আবার চেষ্টা করুন" on the no-internet page
                web.loadUrl(failedUrl ?: HOME)
                return true
            }
            scheme == "http" || scheme == "https" -> {
                if (isAdminPage(u)) { blockAdmin(); return true } // never in the customer app
                if (isShop(u)) return false                         // shop pages stay inside
                if (belongsToAnotherApp(u)) { openOutside(u); return true }
                return false                                         // payment pages (bKash, SSLCommerz…) stay inside so the order finishes
            }
            scheme == "intent" -> {
                try {
                    val i = Intent.parseUri(u.toString(), Intent.URI_INTENT_SCHEME).apply {
                        addCategory(Intent.CATEGORY_BROWSABLE)
                        component = null
                        selector = null
                    }
                    try {
                        startActivity(i)
                    } catch (e: ActivityNotFoundException) {
                        val fb = i.getStringExtra("browser_fallback_url")
                        if (fb != null) web.loadUrl(fb) else toast(R.string.open_failed)
                    }
                } catch (e: Exception) {
                    toast(R.string.open_failed)
                }
                return true
            }
            else -> { // tel:, mailto:, whatsapp:, sms:, fb: …
                openOutside(u)
                return true
            }
        }
    }

    fun openOutside(u: Uri) {
        try {
            startActivity(Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        } catch (e: Exception) {
            toast(R.string.open_failed)
        }
    }

    private inner class ShopClient : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = handleUrl(request.url)

        @Deprecated("Android 7+ calls the WebResourceRequest version")
        @Suppress("DEPRECATION")
        override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean = handleUrl(Uri.parse(url))

        override fun onPageStarted(view: WebView, url: String?, favicon: Bitmap?) {
            if (url != null && isAdminPage(Uri.parse(url))) { view.stopLoading(); blockAdmin(); return }
            if (url?.startsWith("http") == true) failedUrl = null
            bar.progress = 5
            bar.visibility = View.VISIBLE
            onPageChanged(url)
            // older phones without the early script: mark the page as "in the app" right away
            if (url != null && isShop(Uri.parse(url)) && !WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
                view.evaluateJavascript("document.documentElement.classList.add('in-app')", null)
            }
        }

        override fun onPageFinished(view: WebView, url: String?) {
            bar.visibility = View.GONE
            swipe.isRefreshing = false
            if (url?.startsWith("http") == true) hideSplash()
            onPageChanged(url)
            refreshCartCount()
        }

        override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
            if (url != null && isAdminPage(Uri.parse(url))) { view.stopLoading(); blockAdmin(); return }
            onPageChanged(url) // pages that change address without reloading
        }

        override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
            if (request.isForMainFrame) showOffline(request.url.toString())
        }

        @Deprecated("Android 6+ calls the WebResourceRequest version")
        @Suppress("DEPRECATION")
        override fun onReceivedError(view: WebView, errorCode: Int, description: String?, failingUrl: String?) {
            if (Build.VERSION.SDK_INT < 23) showOffline(failingUrl)
        }
    }

    /** Someone tried to reach the admin panel from the customer app: back to the shop, and drop the history. */
    private fun blockAdmin() {
        ui.post {
            web.stopLoading()
            selectTab(TAB_HOME)
            web.loadUrl(HOME)
            ui.postDelayed({ web.clearHistory() }, 1500)
        }
    }

    private fun showOffline(url: String?) {
        failedUrl = url
        hideSplash()
        swipe.isRefreshing = false
        val page = """
            <!doctype html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>
            <style>body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:90vh;margin:0;padding:24px;text-align:center;color:#14213d;background:#fff}
            h2{margin:12px 0 6px}p{color:#5b6475;margin:0 0 22px}a{background:#0866D6;color:#fff;text-decoration:none;padding:12px 26px;border-radius:10px;font-weight:bold}</style></head>
            <body><div style='font-size:56px'>📶</div><h2>ইন্টারনেট সংযোগ নেই</h2><p>মোবাইল ডাটা বা Wi-Fi চালু আছে কিনা দেখে আবার চেষ্টা করুন।</p>
            <a href='shobmilbe://retry'>🔄 আবার চেষ্টা করুন</a></body></html>
        """.trimIndent()
        web.loadDataWithBaseURL(null, page, "text/html", "utf-8", null)
    }

    private fun hideSplash() {
        if (splash.visibility == View.VISIBLE) {
            splash.animate().alpha(0f).setDuration(250).withEndAction { splash.visibility = View.GONE }.start()
        }
    }

    // ---------------- photos, camera, video ----------------
    private inner class ShopChrome : WebChromeClient() {
        override fun onProgressChanged(view: WebView, p: Int) {
            bar.progress = max(5, p)
            if (p >= 100) bar.visibility = View.GONE
        }

        // <input type="file"> — e.g. photos for a return request
        override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
            fileCallback?.onReceiveValue(null)
            fileCallback = callback
            return try {
                val pick = params.createIntent()
                if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                @Suppress("DEPRECATION")
                startActivityForResult(Intent.createChooser(pick, null), REQ_FILE)
                true
            } catch (e: Exception) {
                fileCallback = null
                false
            }
        }

        // live camera inside a page (e.g. "ছবি তুলুন")
        override fun onPermissionRequest(request: PermissionRequest) {
            val wantsCamera = PermissionRequest.RESOURCE_VIDEO_CAPTURE in request.resources
            if (!wantsCamera || !isShop(request.origin)) { request.deny(); return }
            if (Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
            } else {
                pendingCamera = request
                requestPermissions(arrayOf(Manifest.permission.CAMERA), REQ_CAMERA)
            }
        }

        // YouTube video full screen
        override fun onShowCustomView(view: View, callback: CustomViewCallback) {
            if (fullScreenView != null) { callback.onCustomViewHidden(); return }
            fullScreenView = view
            fullScreenCallback = callback
            fullScreenBox.addView(view, FrameLayout.LayoutParams(MATCH_PARENT, MATCH_PARENT))
            fullScreenBox.visibility = View.VISIBLE
            WindowCompat.getInsetsController(window, window.decorView).apply {
                hide(WindowInsetsCompat.Type.systemBars())
                systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            }
        }

        override fun onHideCustomView() = exitFullScreen()
    }

    private fun exitFullScreen() {
        val v = fullScreenView ?: return
        fullScreenBox.removeView(v)
        fullScreenBox.visibility = View.GONE
        fullScreenView = null
        WindowCompat.getInsetsController(window, window.decorView).show(WindowInsetsCompat.Type.systemBars())
        fullScreenCallback?.onCustomViewHidden()
        fullScreenCallback = null
    }

    @Deprecated("The file picker still answers here")
    @Suppress("DEPRECATION")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        val cb = fileCallback
        if (requestCode != REQ_FILE || cb == null) return
        var result: Array<Uri>? = null
        if (resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            result = when {
                clip != null -> Array(clip.itemCount) { clip.getItemAt(it).uri }
                data.data != null -> arrayOf(data.data!!)
                else -> null
            }
        }
        cb.onReceiveValue(result)
        fileCallback = null
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        val req = pendingCamera
        if (requestCode == REQ_CAMERA && req != null) {
            if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) req.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE)) else req.deny()
            pendingCamera = null
        }
    }

    // ---------------- offer notifications ----------------
    private fun askNotificationPermissionOnce() {
        if (Build.VERSION.SDK_INT < 33) return
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return
        val p = getSharedPreferences("app", MODE_PRIVATE)
        if (p.getBoolean("asked_notify", false)) return
        p.edit().putBoolean("asked_notify", true).apply()
        // ask a few seconds after the shop has opened, not on top of the splash
        ui.postDelayed({
            if (!isFinishing) requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIFY)
        }, 8000)
    }

    // ---------------- helpers ----------------
    fun dp(v: Int): Int = (v * resources.displayMetrics.density).roundToInt()

    fun toast(res: Int) = Toast.makeText(this, res, Toast.LENGTH_SHORT).show()
}
