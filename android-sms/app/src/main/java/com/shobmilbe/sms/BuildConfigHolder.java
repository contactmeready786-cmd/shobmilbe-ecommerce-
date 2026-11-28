package com.shobmilbe.sms;

import android.content.Context;

/** The app's version name (shown on screen and sent to the shop). */
final class BuildConfigHolder {
    private BuildConfigHolder() {}
    private static String v;

    static String version(Context c) {
        if (v == null) {
            try { v = c.getPackageManager().getPackageInfo(c.getPackageName(), 0).versionName; } catch (Exception e) { v = "?"; }
        }
        return v;
    }
}
