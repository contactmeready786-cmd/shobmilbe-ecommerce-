/* সবমিলবে — বাংলা ⇄ English switch (no page reload).
 *
 * How it works
 *  - The page always arrives in Bangla. In English mode every piece of visible text is swapped for its English
 *    version right in the page; switching back puts the exact original Bangla back.
 *  - The shop's own words (buttons, headings, messages) are translated by hand below (WORDS).
 *  - What the owner writes (product names, descriptions, categories, banners, blog…) comes from the server,
 *    translated once and kept; it is also remembered in this browser, so the next visit is instant.
 *  - Lines the owner corrected in Admin → স্টোর ডিজাইন → ভাষা always win.
 *  - Anything marked translate="no" (logo, customer's name/phone/address) is never touched or sent anywhere.
 */
(function () {
  'use strict';
  var CFG = window.SM && window.SM.i18n;
  if (!CFG || !document.body) return;

  // ------------------------------------------------------------------ hand-made translations
  // {n} = a number (any digits), {t} = text that is itself translated, {k} = text kept exactly as it is.
  // In the English side, {0} {1} … are those parts in order. "^" at the start = no space before it.
  // "class|text" = only inside an element with that class.
  var WORDS = {
    // header, menu, footer
    'সবমিলবে': 'Shobmilbe',
    'অনলাইন শপ': 'Online Shop',
    '{t} | অনলাইন শপ': '{0} | Online Shop',
    'মূল অংশে যান': 'Skip to main content',
    'মেনু': 'Menu',
    'প্রধান মেনু': 'Main menu',
    '{t} হোম': '{0} home',
    'পণ্য খুঁজুন': 'Search products',
    'কী খুঁজছেন? যেমন: capacitor': 'What are you looking for? e.g. capacitor',
    'খুঁজুন': 'Search',
    'সব পণ্য': 'All Products',
    'অফার': 'Offers',
    'ব্লগ': 'Blog',
    'অর্ডার ট্র্যাক': 'Track Order',
    'অর্ডার ট্র্যাক করুন': 'Track Your Order',
    'লাইভ স্কোর': 'Live Score',
    'কার্ট': 'Cart',
    'ক্যাটাগরি': 'Categories',
    'বন্ধ করুন': 'Close',
    'সব {t} →': 'All {0} →',
    'কেনাকাটা': 'Shop',
    'তথ্য': 'Information',
    'যোগাযোগ': 'Contact',
    '© {n} {t} · সর্বস্বত্ব সংরক্ষিত': '© {0} {1} · All rights reserved',
    'WhatsApp এ চ্যাট করুন': 'Chat on WhatsApp',
    'Messenger এ চ্যাট করুন': 'Chat on Messenger',
    '🏏 ক্রিকেট স্কোর': '🏏 Cricket Score',
    '⚽ ফুটবল স্কোর': '⚽ Football Score',
    'আমাদের সম্পর্কে': 'About Us',
    'রিটার্ন ও রিফান্ড নীতি': 'Return & Refund Policy',
    'প্রাইভেসি পলিসি': 'Privacy Policy',
    'শর্তাবলি': 'Terms & Conditions',
    'ইলেকট্রনিক্স কম্পোনেন্ট থেকে প্রতিদিনের দরকারি জিনিস, সবই এক জায়গায়।': 'From electronic components to everyday essentials — everything in one place.',
    '🚚 সারা বাংলাদেশে হোম ডেলিভারি, পণ্য হাতে পেয়ে টাকা দিন': '🚚 Delivery all over Bangladesh · Cash on delivery',
    'দরকারি সব পার্টস, এক দোকানে': 'All the parts you need, in one shop',

    // product cards & lists
    '{n}% ছাড়': '{0}% OFF',
    'প্যাকেজ': 'Bundle',
    '/পিস': '/pc',
    'কমপক্ষে {n}টি': 'Min. {0} pcs',
    'স্টকে নেই': 'Out of Stock',
    'কার্টে যোগ করুন': 'Add to Cart',
    'এখনই কিনুন': 'Buy Now',
    'কোনো পণ্য পাওয়া যায়নি।': 'No products found.',
    'সব পণ্য দেখুন': 'View All Products',
    'সারা দেশে ডেলিভারি': 'Nationwide Delivery',
    'ঢাকায় ৳{n}, বাইরে ৳{n}': 'Dhaka ৳{0}, outside ৳{1}',
    'ক্যাশ অন ডেলিভারি': 'Cash on Delivery',
    'পণ্য হাতে পেয়ে টাকা': 'Pay on receipt',
    'সহজ রিটার্ন': 'Easy Returns',
    'সমস্যা থাকলে ফেরত': 'Return it if there’s a problem',
    'সাহায্য দরকার?': 'Need Help?',
    'আমাদের মেসেজ দিন': 'Message us',
    'সব দেখুন →': 'View All →',
    'cat-count|{n}টি': '{0} items',
    '{n}টি': '{0} pcs',
    'আগের পণ্য': 'Previous products',
    'পরের পণ্য': 'Next products',
    'কেনাকাটা শুরু করুন': 'Start Shopping',
    'স্লাইড {n}': 'Slide {0}',
    '🆕 নতুন এসেছে': '🆕 New Arrivals',
    'নতুন': 'New',
    'সদ্য দোকানে তোলা পণ্য': 'Just added to the shop',
    '🔥 অফারে আছে': '🔥 On Offer',
    'সীমিত সময়ের ছাড়': 'Limited-time discounts',
    '🏆 সবচেয়ে বেশি বিক্রি': '🏆 Best Sellers',
    'বেস্ট সেলার': 'Best Seller',
    'কাস্টমাররা যা সবচেয়ে বেশি কিনছেন': 'What customers are buying most',
    '👀 সবাই দেখছে': '👀 Trending Now',
    'জনপ্রিয়': 'Popular',
    'এই সপ্তাহে সবচেয়ে বেশি দেখা পণ্য': 'Most viewed products this week',
    '⭐ আমাদের বাছাই': '⭐ Our Picks',
    'যাচাই করা ভালো মানের পণ্য': 'Checked, good-quality products',
    '💰 ৳{n} এর মধ্যে দরকারি জিনিস': '💰 Essentials under ৳{0}',
    'কম দামে প্রতিদিনের দরকারি পার্টস': 'Everyday parts at low prices',
    'ব্লগ ও টিপস': 'Blog & Tips',
    '"{k}" এর ফলাফল': 'Results for "{0}"',
    'খুঁজুন: {k}': 'Search: {0}',
    'অফারের পণ্য': 'Products on Offer',
    'নতুন আগে': 'Newest First',
    'বেশি বিক্রি': 'Best Selling',
    'দাম: কম থেকে বেশি': 'Price: Low to High',
    'দাম: বেশি থেকে কম': 'Price: High to Low',
    'সব': 'All',
    '"{k}" নামে কোনো পণ্য পাওয়া যায়নি। অন্য নামে খুঁজে দেখুন।': 'No products found for "{0}". Try searching with a different name.',
    'এখানে এখনো পণ্য নেই।': 'No products here yet.',
    '← আগের': '← Previous',
    'পরের →': 'Next →',
    'পেজ': 'Pages',
    'অবস্থান': 'Breadcrumb',
    'হোম': 'Home',
    '{n}টি পণ্য': '{0} products',
    'সাজান': 'Sort by',

    // product page
    'ভিডিও চালান': 'Play video',
    '{t} — ভিডিও': '{0} — video',
    'ভিডিও না চললে': 'If the video doesn’t play,',
    'সরাসরি YouTube-এ দেখুন ↗': 'watch it on YouTube ↗',
    'WhatsApp এ কথা বলুন': 'Chat on WhatsApp',
    'ছবি বড় করে দেখুন': 'View larger image',
    '⤢ বড় করে দেখুন': '⤢ Zoom',
    'পণ্যের ভিডিও': 'Product video',
    'ছবি {n}': 'Image {0}',
    'ছবি': 'Image',
    'আগের ছবি': 'Previous image',
    'পরের ছবি': 'Next image',
    'ভিডিও দেখুন': 'Watch video',
    'পণ্যের ভিডিও দেখুন': 'Watch Product Video',
    '· ব্র্যান্ড:': '· Brand:',
    'ব্র্যান্ড:': 'Brand:',
    '৳{n} সাশ্রয়': 'Save ৳{0}',
    'কম দামের পণ্য:': 'Low-price item:',
    'প্রতি পিস ৳{n}। কমপক্ষে': '৳{0} per piece. You must buy at least',
    'নিতে হবে (৳{n})। একসাথে সর্বোচ্চ {n}টি।': '(৳{0}). Maximum {1} pcs per order.',
    'মাত্র {n}টি বাকি আছে': 'Only {0} left in stock',
    '✓ স্টকে আছে': '✓ In Stock',
    'বিস্তারিত বিবরণ পড়ুন ↓': 'Read full description ↓',
    '📝 সংক্ষেপে': '📝 Summary',
    'এই প্যাকেজে যা যা আছে:': 'This bundle includes:',
    '{t} × {n}': '{0} × {1}',
    'আলাদা কিনলে ৳{n} — প্যাকেজে ৳{n} কম!': 'Bought separately: ৳{0} — save ৳{1} with this bundle!',
    'এই পণ্যটি কমপক্ষে {n}টি নিতে হয়, কিন্তু স্টকে আছে {n}টি। নিতে চাইলে সরাসরি যোগাযোগ করুন।': 'The minimum for this item is {0} pcs, but only {1} pcs are in stock. Please contact us directly to order it.',
    '📞 স্টক জানতে কল করুন': '📞 Call to Check Stock',
    'কমান': 'Decrease',
    'পরিমাণ': 'Quantity',
    'বাড়ান': 'Increase',
    '🚚 ঢাকা সিটিতে ডেলিভারি ৳{n}, ঢাকার বাইরে ৳{n}': '🚚 Delivery ৳{0} inside Dhaka city, ৳{1} outside Dhaka',
    '💵 পণ্য হাতে পেয়ে টাকা দিন (ক্যাশ অন ডেলিভারি)': '💵 Pay when you receive the product (Cash on Delivery)',
    '📞 প্রশ্ন থাকলে কল করুন:': '📞 Questions? Call us:',
    '🛒 এই পণ্যটি একসাথে সর্বোচ্চ {n}টি অর্ডার করা যাবে। বেশি দরকার হলে সরাসরি যোগাযোগ করুন': '🛒 You can order up to {0} pcs of this item at once. Need more? Contact us directly.',
    '🛒 এই পণ্যটি একসাথে সর্বোচ্চ {n}টি অর্ডার করা যাবে': '🛒 You can order up to {0} pcs of this item at once.',
    '📋 পণ্যের বিস্তারিত বিবরণ': '📋 Product Details',
    '▶ ভিডিও': '▶ Video',
    '🚚 ডেলিভারি ও রিটার্ন': '🚚 Delivery & Returns',
    'এই পণ্যের বিস্তারিত বিবরণ শীঘ্রই যোগ হবে।': 'Details for this product will be added soon.',
    'ঢাকা সিটির ভেতরে: ৳{n}, সাধারণত ১-২ দিনে।': 'Inside Dhaka city: ৳{0}, usually within 1–2 days.',
    'ঢাকার বাইরে: ৳{n}, সাধারণত ২-৪ দিনে।': 'Outside Dhaka: ৳{0}, usually within 2–4 days.',
    '৳{n} বা বেশি কিনলে ডেলিভারি ফ্রি।': 'Free delivery on orders of ৳{0} or more.',
    'পণ্য হাতে পেয়ে দেখে টাকা দিন। কোনো সমস্যা থাকলে ডেলিভারিম্যানের সামনেই জানান।': 'Check the product when you receive it, then pay. If there’s any problem, tell the delivery person right there.',
    'রিটার্ন নীতি বিস্তারিত →': 'Return policy details →',
    '▶ পণ্যের ভিডিও': '▶ Product Video',
    'একই রকম আরও পণ্য': 'Similar Products',
    'পিস': 'pc',

    // cart & checkout
    'আপনার কার্ট': 'Your Cart',
    'লোড হচ্ছে…': 'Loading…',
    'অর্ডার করুন': 'Checkout',
    'ডেলিভারির তথ্য': 'Delivery Information',
    'আপনার নাম': 'Your Name',
    'মোবাইল নম্বর': 'Mobile Number',
    'এই নম্বরে কল করে অর্ডার কনফার্ম করা হবে।': 'We’ll call this number to confirm your order.',
    'জেলা': 'District',
    'থানা / উপজেলা': 'Thana / Upazila',
    'আগে জেলা বাছুন': 'Select a district first',
    'পূর্ণ ঠিকানা': 'Full Address',
    'বাসা নং, রোড, এলাকা': 'House no., road, area',
    'বিশেষ নির্দেশনা (ঐচ্ছিক)': 'Special Instructions (optional)',
    'পেমেন্ট': 'Payment',
    'নিচের নম্বরে Send Money করে Transaction ID লিখুন।': 'Send Money to the number below and enter the Transaction ID.',
    '({k})। পরিমাণ:': '({0}). Amount:',
    'যে নম্বর থেকে পাঠিয়েছেন': 'Number you sent from',
    'অর্ডার কনফার্ম করুন': 'Confirm Order',
    'অর্ডার করার মাধ্যমে আপনি আমাদের': 'By placing an order, you agree to our',
    'মেনে নিচ্ছেন।': '^.',
    'অর্ডারের সারাংশ': 'Order Summary',
    'কুপন কোড আছে?': 'Have a coupon code?',
    'কোড লিখুন': 'Enter code',
    'প্রয়োগ': 'Apply',
    'বিকাশ দিয়ে পেমেন্ট': 'Pay with bKash',
    'বিকাশ পেমেন্ট পেজে নিয়ে যাওয়া হবে': 'You’ll be taken to the bKash payment page',
    'কার্ড / নগদ / রকেট / ব্যাংক': 'Card / Nagad / Rocket / Bank',
    'Visa, Mastercard, নগদ, রকেট সহ সব মাধ্যম (SSLCommerz)': 'All methods incl. Visa, Mastercard, Nagad, Rocket (SSLCommerz)',
    'বিকাশ': 'bKash',
    'নগদ': 'Nagad',
    'রকেট': 'Rocket',
    'উপায়': 'Upay',
    '{t} Send Money': '{0} Send Money',
    '{k} ({k}) নম্বরে টাকা পাঠিয়ে TrxID দিন': 'Send money to {0} ({1}) and enter the TrxID',
    'পণ্য হাতে পেয়ে টাকা দিন': 'Pay when you receive the product',
    'আপনার কার্ট এখন খালি।': 'Your cart is empty.',
    'পণ্য দেখুন': 'Browse Products',
    'সরান': 'Remove',
    '৳{n} করে': '৳{0} each',
    '🔩 কম দামের পণ্য: কমপক্ষে {n}টি (৳{n})': '🔩 Low-price item: minimum {0} pcs (৳{1})',
    'স্টকে আছে মাত্র {n}টি': 'Only {0} pcs in stock',
    'এখন স্টকে নেই': 'Currently out of stock',
    'পণ্যের মোট দাম': 'Products Total',
    '🎉 আপনি ফ্রি ডেলিভারি পাচ্ছেন!': '🎉 You’re getting free delivery!',
    'আরও ৳{n} কিনলে ডেলিভারি ফ্রি।': 'Buy ৳{0} more to get free delivery.',
    'ডেলিভারি চার্জ পরের ধাপে এলাকা অনুযায়ী যোগ হবে।': 'The delivery charge is added at the next step, based on your area.',
    'কিছু পণ্যের পরিমাণ স্টকের চেয়ে বেশি। পরিমাণ কমিয়ে নিন।': 'Some quantities are more than what’s in stock. Please reduce them.',
    'অর্ডার করতে এগিয়ে যান': 'Proceed to Checkout',
    'আরও পণ্য দেখুন': 'Browse More Products',
    'কার্ট লোড করা যায়নি। ইন্টারনেট সংযোগ দেখে পেজটি রিফ্রেশ করুন।': 'Couldn’t load the cart. Check your internet connection and refresh the page.',
    'কার্ট লোড করা যায়নি। পেজটি রিফ্রেশ করুন।': 'Couldn’t load the cart. Please refresh the page.',
    'কমপক্ষে ১টি থাকতে হবে। না চাইলে "সরান" চাপুন।': 'The minimum quantity is 1. If you don’t want it, tap "Remove".',
    'এটি কম দামের পণ্য — কমপক্ষে {n}টি নিতে হবে (৳{n})। না চাইলে "সরান" চাপুন।': 'This is a low-price item — you must buy at least {0} pcs (৳{1}). If you don’t want it, tap "Remove".',
    'কম দামের পণ্য — কমপক্ষে {n}টি নিতে হবে (৳{n})।': 'Low-price item — you must buy at least {0} pcs (৳{1}).',
    'এই পণ্যটি একসাথে সর্বোচ্চ {n}টি অর্ডার করা যাবে। এর বেশি দরকার হলে সরাসরি আমাদের সাথে যোগাযোগ করুন —': 'You can order up to {0} pcs of this item at once. For more, contact us directly —',
    'এই পণ্যটি একসাথে সর্বোচ্চ {n}টি অর্ডার করা যাবে। এর বেশি দরকার হলে সরাসরি আমাদের সাথে যোগাযোগ করুন।': 'You can order up to {0} pcs of this item at once. For more, please contact us directly.',
    '📞 কল করুন': '📞 Call Us',
    '✅ "{t}" — কম দামের পণ্য, তাই কমপক্ষে {n}টি (৳{n}) কার্টে যোগ হয়েছে': '✅ "{0}" — low-price item, so the minimum {1} pcs (৳{2}) were added to your cart',
    '✅ "{t}" কার্টে যোগ হয়েছে': '✅ "{0}" added to cart',
    'কার্ট দেখুন': 'View Cart',
    'জেলা বাছুন': 'Select District',
    'থানা / উপজেলা বাছুন': 'Select Thana / Upazila',
    'কার্ট খালি।': 'Your cart is empty.',
    'কুপন ছাড় ({k})': 'Coupon Discount ({0})',
    'এলাকা বাছুন': 'Select area',
    'কার্ট এডিট করুন': 'Edit Cart',
    '✓ ঢাকা সিটির ভেতরে — ডেলিভারি চার্জ ৳{n}': '✓ Inside Dhaka city — delivery charge ৳{0}',
    'ঢাকা সিটির বাইরে — ডেলিভারি চার্জ ৳{n}': 'Outside Dhaka city — delivery charge ৳{0}',
    'অর্ডার কনফার্ম করুন · ৳{n}': 'Confirm Order · ৳{0}',
    'যাচাই হচ্ছে…': 'Checking…',
    'যাচাই করা যায়নি, আবার চেষ্টা করুন।': 'Couldn’t check it, please try again.',
    'আপনার নাম লিখুন।': 'Please enter your name.',
    'মোবাইল নম্বর লিখুন।': 'Please enter your mobile number.',
    'জেলা বাছুন।': 'Please select your district.',
    'থানা / উপজেলা বাছুন।': 'Please select your thana / upazila.',
    'পূর্ণ ঠিকানা লিখুন, যাতে ডেলিভারিম্যান সহজে খুঁজে পান।': 'Please enter your full address so the delivery person can find you easily.',
    'অর্ডার পাঠানো হচ্ছে…': 'Placing your order…',
    'অর্ডার পাঠানো যায়নি। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।': 'Couldn’t place the order. Check your internet connection and try again.',
    // messages from the server
    'সঠিক মোবাইল নম্বর দিন, যেমন 01712345678।': 'Please enter a valid mobile number, e.g. 01712345678.',
    'জেলা বাছাই করুন।': 'Please select your district.',
    'থানা / উপজেলা বাছাই করুন।': 'Please select your thana / upazila.',
    'অর্ডার নেওয়া যাচ্ছে না।': 'We can’t take this order right now.',
    'এই নম্বর থেকে আজ অনেকগুলো অর্ডার হয়েছে। আরও অর্ডার করতে আমাদের কল করুন।': 'Many orders have been placed from this number today. Please call us to order more.',
    'এই নম্বর থেকে আজ অনেকগুলো অর্ডার হয়েছে। আরও অর্ডার করতে আমাদের কল করুন: {k}।': 'Many orders have been placed from this number today. To order more, please call us: {0}.',
    'টাকা পাঠানোর পর পাওয়া Transaction ID (TrxID) লিখুন।': 'Please enter the Transaction ID (TrxID) you received after sending the money.',
    'যে নম্বর থেকে টাকা পাঠিয়েছেন সেটা লিখুন।': 'Please enter the number you sent the money from.',
    'দুঃখিত, এই নম্বর থেকে অনলাইনে অর্ডার নেওয়া যাচ্ছে না। অর্ডার করতে আমাদের কল করুন।': 'Sorry, we can’t accept online orders from this number. Please call us to place your order.',
    'অনেক বেশি চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।': 'Too many attempts. Please try again in a little while.',
    'এই কুপন কোডটি সঠিক নয়।': 'This coupon code is not valid.',
    'এই কুপন এখনো চালু হয়নি।': 'This coupon is not active yet.',
    'এই কুপনের মেয়াদ শেষ।': 'This coupon has expired.',
    'এই কুপন আর ব্যবহার করা যাবে না।': 'This coupon can no longer be used.',
    'এই কুপন ব্যবহার করতে কমপক্ষে ৳{n} এর পণ্য কিনতে হবে।': 'You need to buy at least ৳{0} worth of products to use this coupon.',
    'আপনি এই কুপন আগেই ব্যবহার করেছেন।': 'You have already used this coupon.',
    'কুপন যোগ হয়েছে।': 'Coupon applied.',
    'একটি পণ্য আর পাওয়া যাচ্ছে না। কার্ট থেকে সরিয়ে আবার চেষ্টা করুন।': 'One of the products is no longer available. Remove it from your cart and try again.',
    '"{t}" প্যাকেজে কোনো পণ্য সেট করা নেই।': 'The bundle "{0}" has no products set up yet.',
    '"{t}" স্টকে আছে মাত্র {n}টি। পরিমাণ কমিয়ে আবার চেষ্টা করুন।': 'Only {1} pcs of "{0}" are in stock. Please reduce the quantity and try again.',
    '"{t}" এখন স্টকে নেই।': '"{0}" is out of stock now.',
    'কার্ট খালি। আগে পণ্য যোগ করুন।': 'Your cart is empty. Please add products first.',
    '"{t}" কম দামের পণ্য (প্রতি পিস ৳{n}) — কমপক্ষে {n}টি নিতে হবে (৳{n})। কার্টে গিয়ে পরিমাণ বাড়িয়ে নিন।': '"{0}" is a low-price item (৳{1} per piece) — you must buy at least {2} pcs (৳{3}). Please go to your cart and increase the quantity.',
    '"{t}" একসাথে সর্বোচ্চ {n}টি অর্ডার করা যাবে। এর বেশি দরকার হলে সরাসরি আমাদের সাথে যোগাযোগ করুন।': 'You can order up to {1} pcs of "{0}" at once. For more, please contact us directly.',
    '"{t}" একসাথে সর্বোচ্চ {n}টি অর্ডার করা যাবে। এর বেশি দরকার হলে সরাসরি আমাদের সাথে যোগাযোগ করুন — {t}।': 'You can order up to {1} pcs of "{0}" at once. For more, contact us directly — {2}.',
    'কল করুন {k} অথবা WhatsApp এ মেসেজ দিন': 'call {0} or message us on WhatsApp',
    'কল করুন {k}': 'call {0}',
    'WhatsApp এ মেসেজ দিন': 'message us on WhatsApp',
    'কমপক্ষে ৳{n} এর পণ্য অর্ডার করতে হবে।': 'The minimum order amount is ৳{0}.',
    'অর্ডার পাওয়া যায়নি।': 'Order not found.',

    // order confirmation & tracking
    'ধন্যবাদ,': 'Thank you,',
    '! আপনার অর্ডার পেয়েছি।': '! We’ve received your order.',
    'শীঘ্রই আমরা': 'We’ll soon call',
    'নম্বরে কল করে অর্ডার কনফার্ম করব।': 'to confirm your order.',
    'অর্ডারের অবস্থা': 'Order Status',
    'পেমেন্ট সম্পন্ন হয়নি। আবার চেষ্টা করুন, অথবা আমাদের কল করুন — অর্ডারটি সেভ করা আছে।': 'The payment was not completed. Please try again or call us — your order has been saved.',
    'অনলাইন পেমেন্ট বাকি:': 'Online payment due:',
    'এখনই পেমেন্ট করুন': 'Pay Now',
    'আপনার পাঠানো টাকা (TrxID: {k}) আমরা যাচাই করে কনফার্ম করব।': 'We’ll verify the money you sent (TrxID: {0}) and confirm.',
    'এই অর্ডারটি বাতিল।': 'This order has been cancelled.',
    'এই অর্ডারটি ফেরত এসেছে।': 'This order has been returned.',
    'এই অর্ডারটি {t}।': 'Order status: {0}.',
    'নতুন অর্ডার': 'Order Placed',
    'কনফার্ম হয়েছে': 'Confirmed',
    'প্যাকিং চলছে': 'Packing',
    'হোল্ডে আছে': 'On Hold',
    'কুরিয়ারে দেওয়া হয়েছে': 'Shipped',
    'ডেলিভারি সম্পন্ন': 'Delivered',
    'ফেরত এসেছে': 'Returned',
    'বাতিল': 'Cancelled',
    'কুরিয়ার: {k} ·': 'Courier: {0} ·',
    'পার্সেল ট্র্যাক করুন ↗': 'Track Parcel ↗',
    'অর্ডার নম্বরটি লিখে রাখুন। পরে': 'Note down your order number. Later you can check its status on the',
    'পেজে এটা দিয়ে অবস্থা দেখতে পারবেন।': 'page using this number.',
    'অর্ডার নম্বর': 'Order Number',
    'তারিখ': 'Date',
    'মোট': 'Total',
    'পণ্যসমূহ': 'Items',
    'পণ্যের দাম': 'Subtotal',
    'ছাড়': 'Discount',
    'ছাড় ({k})': 'Discount ({0})',
    'ডেলিভারি চার্জ': 'Delivery Charge',
    'ফ্রি': 'Free',
    'রাউন্ড ফিগার': 'Rounding',
    'পরিশোধিত': 'Paid',
    'ডেলিভারির সময় দিতে হবে': 'Due on delivery',
    'ডেলিভারি ঠিকানা:': 'Delivery address:',
    '🔒 নিরাপত্তার জন্য ঠিকানা আর পুরো মোবাইল নম্বর লুকানো আছে। দেখতে': '🔒 For your security, the address and full mobile number are hidden. To see them, enter your mobile number on the',
    'পেজে মোবাইল নম্বর দিন।': 'page.',
    'আরও কেনাকাটা করুন': 'Continue Shopping',
    'অর্ডার {c}': 'Order {0}',
    'অর্ডার করার পর যে নম্বর পেয়েছিলেন (যেমন SM7K2P9Q) আর আপনার মোবাইল নম্বর দিন।': 'Enter the order number you received after ordering (e.g. SM7K2P9Q) and your mobile number.',
    'অবস্থা দেখুন': 'Check Status',
    'এই অর্ডার নম্বর আর মোবাইল নম্বর মিলছে না। আবার দেখে লিখুন।': 'This order number and mobile number don’t match. Please check and try again.',

    // blog, pages, not found
    'এখনো কোনো লেখা নেই।': 'No posts yet.',
    'আরও পড়ুন': 'Read More',
    'পাওয়া যায়নি': 'Not Found',
    'পেজটি পাওয়া যায়নি': 'Page Not Found',
    'লিংকটি ভুল হতে পারে, অথবা পণ্যটি সরিয়ে ফেলা হয়েছে।': 'The link may be wrong, or the product may have been removed.',
    'হোমে ফিরে যান': 'Back to Home',

    // live scores
    '🏏 ক্রিকেট': '🏏 Cricket',
    '⚽ ফুটবল': '⚽ Football',
    '🏏 লাইভ ক্রিকেট স্কোর': '🏏 Live Cricket Score',
    '⚽ লাইভ ফুটবল স্কোর': '⚽ Live Football Score',
    'লাইভ ক্রিকেট স্কোর': 'Live Cricket Score',
    'লাইভ ফুটবল স্কোর': 'Live Football Score',
    'খেলা': 'Sports',
    'লাইভ': 'Live',
    '● লাইভ': '● LIVE',
    'আসন্ন': 'Upcoming',
    'শেষ': 'Finished',
    'বিরতি': 'Half-time',
    'স্কোর লোড হচ্ছে…': 'Loading scores…',
    'এই মুহূর্তে কোনো খেলা চলছে না।': 'No matches are live right now.',
    'এখন দেখানোর মতো কোনো খেলা নেই। একটু পরে আবার দেখুন।': 'No matches to show right now. Please check back a little later.',
    '⭐ বাংলাদেশ ও প্রিয় দল': '⭐ Bangladesh & Favourite Teams',
    'সর্বশেষ আপডেট: {t} (পুরনো)': 'Last updated: {0} (old)',
    'সর্বশেষ আপডেট: {t}': 'Last updated: {0}',
    'স্কোর আনা যাচ্ছে না। ইন্টারনেট সংযোগ দেখুন, কিছুক্ষণ পর নিজে থেকেই আবার চেষ্টা করবে।': 'Can’t load the scores. Check your internet connection — it will try again automatically shortly.',
    'স্কোর এই মুহূর্তে আনা যাচ্ছে না।': 'Scores can’t be loaded right now.',
    'ফিফা বিশ্বকাপ': 'FIFA World Cup',
    'বিশ্বকাপ বাছাই (এশিয়া)': 'World Cup Qualifiers (Asia)',
    'আন্তর্জাতিক প্রীতি ম্যাচ': 'International Friendlies',
    'এএফসি এশিয়ান কাপ': 'AFC Asian Cup',
    'এশিয়ান কাপ বাছাই': 'Asian Cup Qualifiers',
    'উয়েফা চ্যাম্পিয়ন্স লিগ': 'UEFA Champions League',
    'উয়েফা ইউরোপা লিগ': 'UEFA Europa League',
    'উয়েফা নেশনস লিগ': 'UEFA Nations League',
    'ইউরো চ্যাম্পিয়নশিপ': 'UEFA European Championship',
    'কোপা আমেরিকা': 'Copa América',
    'ইংলিশ প্রিমিয়ার লিগ': 'English Premier League',
    'লা লিগা (স্পেন)': 'La Liga (Spain)',
    'সিরি আ (ইতালি)': 'Serie A (Italy)',
    'বুন্দেসলিগা (জার্মানি)': 'Bundesliga (Germany)',
    'লিগ ওয়ান (ফ্রান্স)': 'Ligue 1 (France)',
    'প্রিমেইরা লিগা (পর্তুগাল)': 'Primeira Liga (Portugal)',
    'এরেডিভিসি (নেদারল্যান্ডস)': 'Eredivisie (Netherlands)',
    'সৌদি প্রো লিগ': 'Saudi Pro League',
    'এমএলএস (আমেরিকা)': 'MLS (USA)',
    'ইন্ডিয়ান সুপার লিগ': 'Indian Super League',
    'ব্রাজিল সিরি আ': 'Brazil Série A',
    'আর্জেন্টিনা লিগ': 'Argentine League',
    'এফএ কাপ': 'FA Cup',
    'বাংলাদেশ': 'Bangladesh'
  };

  // single words inside dates & times ("বুধ, ৮ অক্টো", "আজ, রাত ৮:৩০")
  var WORDMAP = {
    'আজ': 'Today', 'আগামীকাল': 'Tomorrow', 'গতকাল': 'Yesterday',
    'শনি': 'Sat', 'রবি': 'Sun', 'সোম': 'Mon', 'মঙ্গল': 'Tue', 'বুধ': 'Wed', 'বৃহস্পতি': 'Thu', 'শুক্র': 'Fri',
    'শনিবার': 'Saturday', 'রবিবার': 'Sunday', 'সোমবার': 'Monday', 'মঙ্গলবার': 'Tuesday', 'বুধবার': 'Wednesday', 'বৃহস্পতিবার': 'Thursday', 'শুক্রবার': 'Friday',
    'জানু': 'Jan', 'ফেব': 'Feb', 'মার্চ': 'Mar', 'এপ্রি': 'Apr', 'মে': 'May', 'জুন': 'Jun', 'জুল': 'Jul', 'আগ': 'Aug', 'সেপ': 'Sep', 'অক্টো': 'Oct', 'নভে': 'Nov', 'ডিসে': 'Dec',
    'জানুয়ারী': 'January', 'জানুয়ারি': 'January', 'ফেব্রুয়ারী': 'February', 'ফেব্রুয়ারি': 'February', 'এপ্রিল': 'April', 'জুলাই': 'July', 'আগস্ট': 'August',
    'সেপ্টেম্বর': 'September', 'অক্টোবর': 'October', 'নভেম্বর': 'November', 'ডিসেম্বর': 'December'
  };

  // ------------------------------------------------------------------ engine
  var BN = /[ঀ-৥ৰ-৲৴-৿]/; // Bangla letters (not digits or ৳)
  var DIG = '০১২৩৪৫৬৭৮৯';
  var NUM = '([0-9০-৯]+(?:[.,][0-9০-৯]+)*)';
  function lat(s) { return String(s).replace(/[০-৯]/g, function (d) { return String(DIG.indexOf(d)); }); }
  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  var EXACT = Object.create(null);
  var CTX = Object.create(null);
  var TPL = [];
  Object.keys(WORDS).forEach(function (raw) {
    var en = WORDS[raw];
    var key = raw;
    var cls = '';
    var bar = raw.indexOf('|');
    if (bar > 0 && /^[a-z-]+$/.test(raw.slice(0, bar))) { cls = raw.slice(0, bar); key = raw.slice(bar + 1); }
    key = norm(key);
    if (!/\{[ntkc]\}/.test(key)) {
      if (cls) CTX[cls + '|' + key] = en; else EXACT[key] = en;
      return;
    }
    var kinds = [];
    var parts = key.split(/(\{[ntkc]\})/);
    var re = parts.map(function (p) {
      var m = /^\{([ntkc])\}$/.exec(p);
      if (!m) return esc(p);
      kinds.push(m[1]);
      return m[1] === 'n' ? NUM : m[1] === 'c' ? '([A-Za-z0-9][A-Za-z0-9-]*)' : '(.+?)';
    }).join('');
    TPL.push({ re: new RegExp('^' + re + '$'), en: en, kinds: kinds, cls: cls, weight: key.replace(/\{[ntkc]\}/g, '').length });
  });
  TPL.sort(function (a, b) { return b.weight - a.weight; });

  var FIX = Object.create(null);    // owner's corrections
  var CACHE = Object.create(null);  // server translations
  var GEO = null;
  var missed = false;               // set when part of a text is still waiting for the server
  var want = Object.create(null);   // texts to ask the server about

  var STORE = 'sm_i18n';
  try {
    var saved = JSON.parse(localStorage.getItem(STORE) || 'null');
    if (saved && saved.r === CFG.rev && saved.m) CACHE = saved.m;
    var savedFix = JSON.parse(localStorage.getItem(STORE + '_fix') || 'null');
    if (savedFix && savedFix.r === CFG.rev && savedFix.m) FIX = savedFix.m;
  } catch (_) { /* private mode */ }
  function persist() {
    try {
      var s = JSON.stringify({ r: CFG.rev, m: CACHE });
      if (s.length > 1500000) { CACHE = Object.create(null); s = JSON.stringify({ r: CFG.rev, m: {} }); }
      localStorage.setItem(STORE, s);
    } catch (_) { /* full or blocked */ }
  }

  function geo(key) {
    if (!GEO && window.BD_GEO && window.BD_GEO.districts) {
      GEO = Object.create(null);
      window.BD_GEO.districts.forEach(function (d) {
        GEO[d.bn] = d.en;
        GEO[d.bn + ' (' + d.en + ')'] = d.en; // district list at checkout: "ঢাকা (Dhaka)"
        (d.areas || []).forEach(function (a) { if (a[1]) GEO[a[1]] = a[0]; });
      });
    }
    return GEO ? GEO[key] : undefined;
  }

  function fill(t, m) {
    var out = t.en.replace(/\{(\d)\}/g, function (_, i) {
      var v = m[+i + 1];
      var kind = t.kinds[+i];
      if (kind === 'n') return lat(v);
      if (kind === 'k' || kind === 'c') return v;
      var r = tr(v, null, true);
      return r == null ? v : r;
    });
    // "1 items" → "1 item"
    return out.replace(/(^|[^\d.,])1 (item|product|pc)s\b/g, '$11 $2');
  }

  // Bangla → English, or null when not known (yet).
  function tr(text, el, inner) {
    var key = norm(text);
    if (!key) return null;
    if (!BN.test(key)) return /[০-৯]/.test(key) ? lat(key) : null;
    var hit = FIX[key] || null;
    if (!hit && el && el.classList) {
      for (var c = 0; c < el.classList.length && !hit; c++) hit = CTX[el.classList[c] + '|' + key] || null;
    }
    hit = hit || EXACT[key] || CACHE[key] || geo(key) || null;
    if (hit) return hit;
    if (key.indexOf(' | ') > 0) return joined(key, ' | ', el);
    for (var i = 0; i < TPL.length; i++) {
      var t = TPL[i];
      if (t.cls && !(el && el.classList && el.classList.contains(t.cls))) continue;
      var m = t.re.exec(key);
      if (m) return fill(t, m);
    }
    // a leading emoji / symbol or a trailing arrow around a known text: "📟 ইলেকট্রনিক্স", "সব ইলেকট্রনিক্স →"
    var wrap = /^([^ঀ-৿A-Za-z0-9"'(]+)?(.*?)([\s→↗↓›»:.!।]+)?$/.exec(key);
    if (wrap && (wrap[1] || wrap[3]) && wrap[2] && wrap[2] !== key) {
      var core = tr(wrap[2], el, true);
      if (core != null) {
        var suf = wrap[3] ? lat(wrap[3]).replace(/।/g, '.') : '';
        if (/[.!?:]$/.test(core) && /^[.!?:]/.test(suf)) suf = suf.slice(1); // "Done." + "।" → "Done."
        return (wrap[1] || '') + core + suf;
      }
    }
    // dates and times
    var w = words(key);
    if (w != null) return w;
    // a few parts joined with a separator: "পণ্যের নাম | সবমিলবে"
    var seps = [' · ', ' — ', ' / '];
    for (var s = 0; s < seps.length; s++) {
      if (key.indexOf(seps[s]) >= 0) return joined(key, seps[s], el);
    }
    if (inner) { want[key] = 1; missed = true; }
    return null;
  }
  // "পণ্যের নাম | সবমিলবে": each part on its own (a part still unknown stays Bangla until the server answers)
  function joined(key, sep, el) {
    return key.split(sep).map(function (piece) {
      if (!BN.test(piece)) return lat(piece);
      var r = tr(piece, el, true);
      return r == null ? piece : r;
    }).join(sep);
  }

  function time12(part, h, mi, sec) {
    h = +lat(h);
    var pm = part === 'দুপুর' || part === 'বিকাল' || part === 'সন্ধ্যা' || (part === 'রাত' && h >= 6 && h < 12);
    return h + ':' + lat(mi) + (sec ? ':' + lat(sec) : '') + (pm ? ' PM' : ' AM');
  }
  function words(key) {
    var s = key.replace(/(রাত|সকাল|দুপুর|বিকাল|সন্ধ্যা)\s*([0-9০-৯]{1,2}):([0-9০-৯]{2})(?::([0-9০-৯]{2}))?/g,
      function (_, part, h, mi, sec) { return time12(part, h, mi, sec); });
    s = s.replace(/[ঀ-৥ৰ-৿]+/g, function (w) { return WORDMAP[w] || w; });
    s = lat(s).replace(/।/g, '.');
    return BN.test(s) ? null : s;
  }

  // ------------------------------------------------------------------ the page
  var NOATTR = 'script,style,noscript,code,pre,svg,[translate="no"],[contenteditable],[data-no-i18n]';
  var SKIP = NOATTR + ',textarea';
  var ATTRS = ['placeholder', 'title', 'aria-label'];
  var ORIG = new WeakMap();   // text node → {bn, en}
  var AORIG = new WeakMap();  // element → {attr: {bn, en}}
  var waiting = [];           // nodes whose text (or part of it) is being asked from the server
  var lang = 'bn';

  function skipped(el) { return !el || (el.closest ? !!el.closest(SKIP) : false); }
  function noAttr(el) { return !el || (el.closest ? !!el.closest(NOATTR) : false); }

  function doText(n) {
    var v = n.nodeValue;
    if (!v || !/[ঀ-৿]/.test(v)) return;
    var rec = ORIG.get(n);
    if (rec && v === rec.en) return;
    var el = n.parentNode;
    if (el && el.nodeType === 1 && skipped(el)) return;
    missed = false;
    var en = tr(v, el, false);
    if (en == null) {
      if (BN.test(v)) { if (!missed) want[norm(v)] = 1; waiting.push(n); schedule(); }
      return;
    }
    if (missed) { waiting.push(n); schedule(); }
    var lead = /^\s*/.exec(v)[0];
    var tail = /\s*$/.exec(v)[0];
    if (en.charAt(0) === '^') { en = en.slice(1); lead = ''; }
    en = lead + en + tail;
    ORIG.set(n, { bn: v, en: en });
    n.nodeValue = en;
  }
  function doAttrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      var v = el.getAttribute(a);
      if (!v || !BN.test(v)) continue;
      var recs = AORIG.get(el) || {};
      if (recs[a] && recs[a].en === v) continue;
      missed = false;
      var en = tr(v, el, false);
      if (en == null) { if (!missed) want[norm(v)] = 1; waiting.push(el); schedule(); continue; }
      if (missed) { waiting.push(el); schedule(); }
      en = en.replace(/^\^/, '');
      recs[a] = { bn: v, en: en };
      AORIG.set(el, recs);
      el.setAttribute(a, en);
    }
  }
  function walk(root) {
    if (!root) return;
    if (root.nodeType === 3) { doText(root); return; }
    if (root.nodeType !== 1) return;
    if (skipped(root)) { if (root.tagName === 'TEXTAREA' && !noAttr(root)) doAttrs(root); return; }
    var tw = document.createTreeWalker(root, 5 /* elements + text */, {
      acceptNode: function (n) {
        if (n.nodeType !== 1 || !n.matches(SKIP)) return 1;
        if (n.tagName === 'TEXTAREA' && !noAttr(n)) doAttrs(n);
        return 2; /* skip what is inside */
      },
    });
    var n = root;
    do {
      if (n.nodeType === 3) doText(n);
      else if (n.hasAttribute && (n.hasAttribute('placeholder') || n.hasAttribute('title') || n.hasAttribute('aria-label'))) doAttrs(n);
    } while ((n = tw.nextNode()));
  }
  function restore() {
    var tw = document.createTreeWalker(document.body, 4);
    var n;
    while ((n = tw.nextNode())) {
      var rec = ORIG.get(n);
      if (rec && n.nodeValue === rec.en) n.nodeValue = rec.bn;
      if (rec) ORIG.delete(n);
    }
    document.querySelectorAll('[placeholder],[title],[aria-label]').forEach(function (el) {
      var recs = AORIG.get(el);
      if (!recs) return;
      Object.keys(recs).forEach(function (a) { if (el.getAttribute(a) === recs[a].en) el.setAttribute(a, recs[a].bn); });
      AORIG.delete(el);
    });
  }

  var titleBn = document.title;
  function doTitle() {
    if (lang !== 'en') { if (document.title !== titleBn) document.title = titleBn; return; }
    missed = false;
    var t = tr(titleBn, null, false);
    if (t != null) document.title = t;
    else if (BN.test(titleBn)) { want[norm(titleBn)] = 1; schedule(); }
  }

  // ------------------------------------------------------------------ asking the server
  var timer = null;
  var asked = Object.create(null);
  function schedule() { if (!timer) timer = setTimeout(flush, 40); }
  function flush() {
    timer = null;
    var list = Object.keys(want).filter(function (k) { return !asked[k] && k.length <= 3000; });
    want = Object.create(null);
    if (!list.length) return;
    var batches = [];
    for (var i = 0; i < list.length; i += 50) batches.push(list.slice(i, i + 50));
    batches.forEach(function (b) {
      b.forEach(function (k) { asked[k] = 1; });
      fetch('/api/i18n', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: b }) })
        .then(function (r) { return r.ok ? r.json() : { m: {} }; })
        .then(function (j) {
          var got = 0;
          Object.keys((j && j.m) || {}).forEach(function (k) { CACHE[k] = j.m[k]; got++; });
          if (got) { persist(); retry(); }
        })
        .catch(function () { /* offline: the Bangla text stays */ });
    });
  }
  function retry() {
    if (lang !== 'en') return;
    var list = waiting;
    waiting = [];
    list.forEach(function (n) {
      if (!n.isConnected) return;
      if (n.nodeType === 3) {
        var rec = ORIG.get(n);
        if (rec && n.nodeValue === rec.en) { n.nodeValue = rec.bn; ORIG.delete(n); }
        doText(n);
      } else {
        var recs = AORIG.get(n);
        if (recs) Object.keys(recs).forEach(function (a) { if (n.getAttribute(a) === recs[a].en) n.setAttribute(a, recs[a].bn); });
        AORIG.delete(n);
        doAttrs(n);
      }
    });
    doTitle();
  }

  // ------------------------------------------------------------------ watching the page (cart, messages…)
  var mo = new MutationObserver(function (list) {
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (m.type === 'childList') {
        for (var j = 0; j < m.addedNodes.length; j++) {
          var a = m.addedNodes[j];
          if (a.nodeType === 3) { if (!a.parentNode || !skipped(a.parentNode)) doText(a); } else walk(a);
        }
      } else if (m.type === 'characterData') {
        doText(m.target);
      } else if (m.type === 'attributes' && !noAttr(m.target)) {
        doAttrs(m.target);
      }
    }
  });
  var titleEl = document.querySelector('title');
  var to = new MutationObserver(function () {
    if (lang === 'en' && document.title !== titleBn && BN.test(document.title)) { titleBn = document.title; doTitle(); }
  });

  // ------------------------------------------------------------------ switching
  var fixLoaded = false;
  function loadFix() {
    if (fixLoaded) return;
    fixLoaded = true;
    fetch('/api/i18n/fix?v=' + encodeURIComponent(CFG.rev)).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.m) return;
      var changed = JSON.stringify(j.m) !== JSON.stringify(FIX);
      FIX = j.m;
      try { localStorage.setItem(STORE + '_fix', JSON.stringify({ r: CFG.rev, m: FIX })); } catch (_) { /* ignore */ }
      if (changed && lang === 'en') { restore(); walk(document.body); doTitle(); }
    }).catch(function () { /* keep what we have */ });
  }

  function paintSwitch() {
    document.querySelectorAll('[data-lang-switch]').forEach(function (b) {
      b.setAttribute('aria-checked', lang === 'en' ? 'true' : 'false');
      b.classList.toggle('is-en', lang === 'en');
    });
  }
  function setLang(l, save) {
    l = l === 'en' ? 'en' : 'bn';
    if (save) { try { localStorage.setItem('sm_lang', l); } catch (_) { /* ignore */ } }
    var html = document.documentElement;
    html.setAttribute('data-lang', l);
    html.lang = l === 'en' ? 'en' : 'bn';
    if (l !== lang) {
      lang = l;
      if (l === 'en') {
        walk(document.body);
        doTitle();
        mo.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
        if (titleEl) to.observe(titleEl, { childList: true, characterData: true, subtree: true });
        loadFix();
      } else {
        mo.disconnect();
        to.disconnect();
        restore();
        doTitle();
      }
    }
    paintSwitch();
    html.className = html.className.replace(/\s*i18n-wait/g, '');
    document.dispatchEvent(new CustomEvent('sm:lang', { detail: { lang: l } }));
  }

  // tap the switch = flip; tap the word "বাং" or "EN" = that language
  document.addEventListener('click', function (e) {
    var sw = e.target.closest && e.target.closest('[data-lang-switch]');
    if (!sw) return;
    e.preventDefault();
    var side = e.target.closest('[data-lang]');
    if (side && !sw.contains(side)) side = null; // <html> carries data-lang too
    setLang(side ? side.getAttribute('data-lang') : (lang === 'en' ? 'bn' : 'en'), true);
  });

  var start = document.documentElement.getAttribute('data-lang') || CFG.def || 'bn';
  setLang(start, false);
  window.SMLang = { set: function (l) { setLang(l, true); }, get: function () { return lang; }, t: function (s) { return lang === 'en' ? (tr(s, null, false) || s) : s; } };
})();
