// 📱 /app — download the সবমিলবে Android app (a signed APK the shop serves itself; not on Google Play yet).
// Inside the app it says whether the visitor's copy is the newest one.
import { bn } from '../util';
import { APP_RELEASE, olderVersion } from '../app-release';

export function appPage({ inAppVersion, android }: { inAppVersion: string; android: boolean }) {
  const R = APP_RELEASE;
  const old = !!inAppVersion && olderVersion(inAppVersion, R.version);
  const download = (
    <a className="btn btn-amber btn-lg app-dl" href={R.file} download="">⬇️ {old ? 'নতুন সংস্করণ ডাউনলোড করুন' : 'অ্যাপ ডাউনলোড করুন'}</a>
  );
  return (
    <div className="wrap section narrow app-page">
      <nav className="crumbs" aria-label="অবস্থান"><a href="/">হোম</a>{' '}/{' '}<span>অ্যাপ</span></nav>
      <section className="panel app-hero">
        <img className="app-icon" src="/icon-192.png" alt="" width={72} height={72} />
        <div>
          <h1>📱 সবমিলবে অ্যাপ</h1>
          <p className="muted">অর্ডার, অফার আর অর্ডার ট্র্যাক — এক চাপে। অ্যাপ সবসময় মোবাইলের মাপে খোলে, নতুন অফার এলে নোটিফিকেশন পাবেন।</p>
          {inAppVersion && !old ? (
            <p className="app-ok">✅ আপনি অ্যাপের সর্বশেষ সংস্করণেই আছেন (সংস্করণ {bn(inAppVersion)})।</p>
          ) : (
            <>
              {old ? <p className="app-new">🎉 নতুন সংস্করণ {bn(R.version)} এসেছে — আপনার ফোনে আছে {bn(inAppVersion)}। নামিয়ে ইনস্টল করুন, আপনার লগইন আর কার্ট যেমন আছে তেমনই থাকবে।</p> : null}
              {download}
              <p className="small muted">সংস্করণ {bn(R.version)} · {bn(R.sizeMb)} MB · শুধু Android ফোনের জন্য (Android ৫ বা তার পরের)</p>
            </>
          )}
        </div>
      </section>
      {inAppVersion && !old ? null : (
        <section className="panel">
          <h2>কীভাবে ইনস্টল করবেন</h2>
          <ol className="app-steps">
            <li><b>ডাউনলোড করুন:</b> উপরের বোতাম চাপুন। ফাইলটা ({bn(R.sizeMb)} MB) ফোনে নেমে যাবে।</li>
            <li><b>ফাইলটা খুলুন:</b> নোটিফিকেশন থেকে, বা ফোনের <b>Downloads / ফাইল</b> থেকে <code>{R.file.split('/').pop()}</code> চাপুন।</li>
            <li><b>অনুমতি দিন:</b> প্রথমবার ফোন বলতে পারে "এই উৎস থেকে অ্যাপ ইনস্টল করা যাবে না"। <b>সেটিংস</b> চেপে <b>"এই উৎস থেকে অনুমতি দিন"</b> চালু করে ফিরে আসুন।</li>
            <li><b>ইনস্টল</b> চাপুন, তারপর <b>খুলুন</b>। ব্যস!</li>
          </ol>
          <p className="small muted">Google Play Protect যদি "অজানা অ্যাপ" বলে সাবধান করে: অ্যাপটা এখনো Play Store-এ তোলা হয়নি বলেই এমন বলে। এটা সবমিলবের নিজের অ্যাপ, এই সাইট থেকেই দেওয়া — <b>"আরও বিস্তারিত" → "তবুও ইনস্টল করুন"</b> চাপুন।</p>
        </section>
      )}
      <section className="panel">
        <h2>অ্যাপে যা পাবেন</h2>
        <ul className="app-feats">
          <li>🛒 এক চাপে কার্ট, অর্ডার আর আমার অ্যাকাউন্ট</li>
          <li>🔔 নতুন অফার আর অর্ডারের খবর নোটিফিকেশনে</li>
          <li>📦 অর্ডার কোথায় আছে — এক চাপে ট্র্যাক</li>
          <li>📱 সবসময় মোবাইলের মাপে, ব্রাউজারের ঝামেলা ছাড়া</li>
        </ul>
        <p className="small muted">নতুন সংস্করণ এলে অ্যাপের ভেতরেই জানিয়ে দেওয়া হবে — এই পেজ থেকে নামিয়ে আগেরটার উপর ইনস্টল করলেই হবে।</p>
        {!android && !inAppVersion ? <p className="small muted">🍎 আইফোনের জন্য অ্যাপ এখনো নেই। Safari-তে <b>শেয়ার → "Add to Home Screen"</b> চাপলে দোকানটা অ্যাপের মতোই হোম স্ক্রিনে থাকবে।</p> : null}
      </section>
    </div>
  );
}
