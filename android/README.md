# সবমিলবে Android অ্যাপ

একই প্রজেক্ট থেকে দুইটা অ্যাপ হয়:

| অ্যাপ | প্যাকেজ | খুললে যায় | কোথায় যাবে |
|---|---|---|---|
| সবমিলবে | com.shobmilbe.app | দোকানের হোমপেজ | Google Play Store |
| সবমিলবে অ্যাডমিন | com.shobmilbe.admin | /admin | শুধু মালিক/স্টাফের ফোনে (APK সরাসরি) |

**দোকানের অ্যাপ (কাস্টমার):** নিজের ভেতরের ব্রাউজারে (WebView) দোকানটা দেখায়, তাই ফোনের Chrome-এ "ডেস্কটপ সাইট" চালু থাকুক বা না থাকুক — অ্যাপ **সবসময় মোবাইল ভিউতে** খোলে। ওয়েবসাইটে যা বদলান, অ্যাপে সাথে সাথে আসে। WhatsApp / ফোন / Facebook লিংক নিজ নিজ অ্যাপে খোলে; bKash/কার্ড পেমেন্টের পেজ অ্যাপের ভেতরেই থাকে। অফারের নোটিফিকেশন: অ্যাপ প্রতি ~৩০ মিনিটে `/api/app/offers` দেখে নেয় (Firebase লাগে না)।

**অ্যাডমিন অ্যাপ:** ফোনের Chrome ইঞ্জিন দিয়ে চলে (Trusted Web Activity) — পাসকি/ফিঙ্গারপ্রিন্ট, ক্যামেরা স্ক্যান Chrome-এর মতোই চলে।

**আইকন চেপে ধরলে শর্টকাট:** অ্যাডমিন অ্যাপে হ্যান্ডওভার স্ক্যান, অর্ডার, POS; দোকানের অ্যাপে অর্ডার ট্র্যাক, কার্ট, আমার অ্যাকাউন্ট।

## ঠিকানা বদলানো (যেমন shobmilbe.com-এ গেলে)
1. `android/gradle.properties` এ `siteHost` বদলান, `appVersionCode` ১ বাড়ান।
2. `android/app/src/*/res/xml/shortcuts.xml` এ পুরোনো ঠিকানা নতুনটা দিয়ে বদলান।
3. নতুন ঠিকানার সাইটেও `public/.well-known/assetlinks.json` থাকতে হবে (এটা কোডের সাথেই যায়)।

## বানানো
GitHub-এ `android/` এ কিছু বদলালে `android` কাজটা নিজে থেকে চলে আর **সাইন ছাড়া** APK/AAB `android-builds` ব্রাঞ্চে রাখে। রিপোজিটরি সবার জন্য খোলা, তাই সাইনিং কী এখানে কখনো রাখা হয় না — মালিকের কাছে থাকা কী দিয়ে পরে সাইন করা হয়।

নিজের কম্পিউটারে: Android Studio দিয়ে `android` ফোল্ডার খুলুন → Build → Generate Signed App Bundle / APK → `customerRelease` বা `adminRelease`।

## সাইনিং কী (খুব জরুরি)
`shobmilbe-upload.jks` আর তার পাসওয়ার্ড মালিকের কাছে আলাদাভাবে দেওয়া হয়েছে। হারালে অ্যাডমিন অ্যাপ আপডেট করা যাবে না (আর Play Store-এ নতুন আপলোড-কী চাইতে হবে)। Google Drive আর একটা পেনড্রাইভে কপি রাখুন। এর SHA-256 `public/.well-known/assetlinks.json` এ আছে।

Play Store-এ প্রথম আপলোডের পর Play Console → Test and release → App integrity → **App signing key certificate** এর SHA-256 টাও `assetlinks.json` এ `com.shobmilbe.app` এর তালিকায় যোগ করতে হবে, নইলে Play থেকে নামানো অ্যাপে উপরে ঠিকানার বার দেখাবে।
