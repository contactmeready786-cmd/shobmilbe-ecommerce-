# 📱 সবমিলবে SMS — the shop's own SMS app (owner, 2026-11-28)

The owner's Android phone sends the shop's SMS (checkout / login codes, order SMS) from its own SIM.
No outside company or cloud in between: the app asks shobmilbe.com for work (`/api/smsgw/pull`, held open up to
25 seconds, so a code leaves the phone within a second or two), sends it, and reports back (`/api/smsgw/report`).
Server side: `lib/services/smsgw.ts`, `lib/api/smsgw.ts`, Admin → মার্কেটিং → কাস্টমারকে SMS ("সবমিলবে SMS অ্যাপ").

- Pairing: the admin shows a 6-digit code (15 minutes, works once); the app trades it for its own key.
- Up to 10 phones: the owner picks the ⭐ main phone in the admin; the others are backups (the shop decides who
  sends — the app itself needs nothing for this).
- Never sends the same SMS twice (it remembers every id for 2 days and only re-reports).
- Keeps running: foreground service + wake lock, starts by itself after a restart / update, a 15-minute check
  restarts it if the system stopped it. The screen asks to remove it from battery saving (and Xiaomi autostart).
- Plain Java, no libraries, minSdk 24 (Android 7) – targetSdk 35. Built with `build.sh` (SDK tools only, no Gradle).

The signed file is `public/downloads/shobmilbe-sms.apk` (the admin page links to `/downloads/shobmilbe-sms.apk`).
**New version:** raise VERSION_CODE / VERSION_NAME in build.sh, build with the owner's key
(`shobmilbe-sms.jks` + its password — the owner keeps them; never put them in this public repository), replace
the APK in public/downloads. A different key = Android refuses the update (the owner would have to uninstall first).
