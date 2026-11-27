// 🔎 Search words for ইলেকট্রনিক্স পাঠশালা (/learn — owner 2026-11-28: no "ফ্রি" in the name, it reads like an ad) and the tools (/tools) — owner, 2026-11-28.
// Most people in Bangladesh type their search in English ("resistor color code calculator", "104 capacitor value"),
// others in Bangla ("রেজিস্টর কালার কোড", "ভোল্টেজ কি"). So every page gets an English name next to its Bangla
// one (page title, a line under the heading) and a short "প্রশ্ন-উত্তর" (FAQ) written the way people really ask.
// Every number here is checked — students rely on it. tests/seo-learn.test.ts checks that each tool and lesson
// has its entry. A page's address (key / slug) never changes.

export type Faq = { q: string; a: string };
export type SeoInfo = { en: string; keywords: string; faq: Faq[] };

export const LIST_SEO = {
  tools: {
    en: 'Electronics Calculators & Tools in Bangla',
    keywords: 'electronics calculator, resistor color code calculator, ohms law calculator, capacitor code, LED resistor calculator, ইলেকট্রনিক্স ক্যালকুলেটর, রেজিস্টর কালার কোড',
  },
  learn: {
    en: 'Learn Electronics & Arduino in Bangla',
    keywords: 'free electronics course bangla, arduino bangla tutorial, electronics basics bangla, ইলেকট্রনিক্স শেখা, আরডুইনো শেখা, ইলেকট্রনিক্স পাঠশালা',
    faq: [
      { q: 'এখানে শিখতে কি টাকা বা অ্যাকাউন্ট লাগে?', a: 'না। লেসন পড়া, কুইজ দেওয়া আর সার্টিফিকেট নেওয়ার জন্য কোনো খরচ বা অ্যাকাউন্ট লাগে না।' },
      { q: 'কারা এই ক্লাস করতে পারবে?', a: 'স্কুল, কলেজ, ভার্সিটির স্টুডেন্ট, শখের মানুষ বা টেকনিশিয়ান — যে কেউ। একদম শুরু থেকে শেখানো হয়েছে, আগে কিছু জানা লাগবে না।' },
      { q: 'সার্টিফিকেট কীভাবে পাব?', a: 'সবগুলো লেসনের কুইজ পাশ করলে এই পাতায় নিজের নাম লিখে সার্টিফিকেট বানিয়ে ছবি হিসেবে ডাউনলোড করতে পারবেন।' },
      { q: 'আরডুইনো শিখতে কী কী লাগবে?', a: 'একটা Arduino Uno, USB তার, ব্রেডবোর্ড, কয়েকটা LED আর ২২০Ω রেজিস্টর আর জাম্পার তার — শুরু করার জন্য এটুকুই যথেষ্ট।' },
    ] as Faq[],
  },
};

export const TOOL_SEO: Record<string, SeoInfo> = {
  'resistor-color-code': {
    en: 'Resistor Color Code Calculator (3, 4, 5, 6 Band)',
    keywords: 'resistor color code, resistor color code calculator, 4 band resistor, 5 band resistor, resistor value, রেজিস্টর কালার কোড, রেজিস্টরের মান',
    faq: [
      { q: '১০k (10kΩ) রেজিস্টরের রং কী?', a: '৪ দাগে: বাদামি-কালো-কমলা-সোনালি (১০ × ১০০০ = ১০kΩ, ±৫%)। ৫ দাগে: বাদামি-কালো-কালো-লাল-বাদামি (১০০ × ১০০ = ১০kΩ, ±১%)।' },
      { q: '২২০ ওহম রেজিস্টরের রং কী?', a: '৪ দাগে: লাল-লাল-বাদামি-সোনালি (২২ × ১০ = ২২০Ω)। ৫ দাগে: লাল-লাল-কালো-কালো-বাদামি (২২০ × ১ = ২২০Ω)।' },
      { q: '৪.৭k (4.7kΩ) রেজিস্টরের রং কী?', a: '৪ দাগে: হলুদ-বেগুনি-লাল-সোনালি (৪৭ × ১০০ = ৪৭০০Ω = ৪.৭kΩ)।' },
      { q: 'রেজিস্টরের দাগ কোন দিক থেকে পড়ব?', a: 'সোনালি বা রুপালি দাগটা (টলারেন্স) ডান দিকে রাখুন, সেটা একটু দূরে আলাদা থাকে। বাম দিকের প্রথম দাগ থেকে পড়া শুরু করুন — সোনালি বা রুপালি কখনো প্রথম দাগ হয় না।' },
      { q: '৩ দাগের রেজিস্টরের টলারেন্স কত?', a: '৩ দাগের রেজিস্টরে টলারেন্সের আলাদা দাগ থাকে না, তাই টলারেন্স ±২০% ধরা হয় (আন্তর্জাতিক মান IEC 60062)।' },
    ],
  },
  'smd-resistor-code': {
    en: 'SMD Resistor Code Calculator (3-Digit, 4-Digit, EIA-96)',
    keywords: 'smd resistor code, smd resistor calculator, 103 smd resistor, eia-96 code, 01C resistor, SMD রেজিস্টর কোড',
    faq: [
      { q: 'SMD রেজিস্টরে 103 লেখা মানে কত ওহম?', a: 'প্রথম দুই অঙ্ক ১০, শেষ অঙ্ক ৩ মানে পিছনে ৩টা শূন্য — ১০,০০০Ω = ১০kΩ।' },
      { q: '4R7 মানে কী?', a: 'R মানে দশমিক বিন্দু — 4R7 = ৪.৭Ω। একইভাবে R10 = ০.১Ω।' },
      { q: '01C কোড (EIA-96) মানে কত?', a: 'EIA-96-এ ০১ মানে ১০০, আর C মানে ×১০০ — তাই ১০০ × ১০০ = ১০kΩ (±১%)।' },
      { q: '000 বা 0 লেখা SMD রেজিস্টর কী?', a: 'এটা ০Ω জাম্পার — রেজিস্টর নয়, বোর্ডে দুইটা লাইন জোড়ার কাজ করে।' },
    ],
  },
  'capacitor-code': {
    en: 'Capacitor Code Calculator (104, 103, 473) & pF/nF/µF Converter',
    keywords: 'capacitor code calculator, 104 capacitor value, 103 capacitor, ceramic capacitor code, pf to nf, nf to uf, ক্যাপাসিটর কোড',
    faq: [
      { q: '104 ক্যাপাসিটরের মান কত?', a: '১০ এর পিছনে ৪টা শূন্য = ১,০০,০০০pF = ১০০nF = ০.১µF।' },
      { q: '103 আর 473 ক্যাপাসিটর কত?', a: '103 = ১০,০০০pF = ১০nF = ০.০১µF। 473 = ৪৭,০০০pF = ৪৭nF = ০.০৪৭µF।' },
      { q: 'কোডের শেষে J, K, M মানে কী?', a: 'এগুলো টলারেন্স: J = ±৫%, K = ±১০%, M = ±২০%। যেমন 473J = ৪৭nF ±৫%।' },
      { q: '১µF মানে কত nF আর pF?', a: '১µF = ১০০০nF = ১০,০০,০০০pF।' },
    ],
  },
  'ohms-law': {
    en: "Ohm's Law Calculator (Voltage, Current, Resistance, Power)",
    keywords: "ohms law calculator, ohm's law, voltage current resistance calculator, power calculator, ওহমের সূত্র, V=IR",
    faq: [
      { q: 'ওহমের সূত্র কী?', a: 'V = I × R — ভোল্টেজ = কারেন্ট × রেজিস্ট্যান্স। আর পাওয়ার P = V × I।' },
      { q: '১২V আর ১০০Ω হলে কারেন্ট কত?', a: 'I = V ÷ R = ১২ ÷ ১০০ = ০.১২A = ১২০mA। পাওয়ার P = ১২ × ০.১২ = ১.৪৪W।' },
      { q: 'রেজিস্টর কত ওয়াটের নেব কীভাবে বুঝব?', a: 'P = I² × R দিয়ে পাওয়ার বের করুন, তার অন্তত দ্বিগুণ ওয়াটের রেজিস্টর নিন। যেমন হিসাবে ০.১W হলে ১/৪W (০.২৫W) যথেষ্ট।' },
    ],
  },
  'led-resistor': {
    en: 'LED Resistor Calculator (3.3V, 5V, 12V)',
    keywords: 'led resistor calculator, resistor for led, led resistor 5v, led resistor 12v, LED এর জন্য রেজিস্টর',
    faq: [
      { q: '৫V-এ লাল LED-এর জন্য কত ওহম রেজিস্টর?', a: '(৫ − ২) ÷ ০.০২A = ১৫০Ω। হাতের কাছে ১৫০Ω বা নিরাপদে ২২০Ω লাগান।' },
      { q: '১২V-এ সাদা LED-এর জন্য কত ওহম?', a: '(১২ − ৩.২) ÷ ০.০২A = ৪৪০Ω, তাই কাছের বড় মান ৪৭০Ω। পাওয়ার প্রায় ০.১৮W, তাই ১/২W রেজিস্টর নিলে নিরাপদ।' },
      { q: 'রেজিস্টর ছাড়া LED লাগালে কী হয়?', a: 'কারেন্ট আটকানোর কিছু থাকে না, তাই LED খুব গরম হয়ে কয়েক সেকেন্ডে নষ্ট হতে পারে। সবসময় সিরিজে রেজিস্টর দিন।' },
    ],
  },
  'voltage-divider': {
    en: 'Voltage Divider Calculator (5V to 3.3V)',
    keywords: 'voltage divider calculator, 5v to 3.3v voltage divider, resistor divider, ভোল্টেজ ডিভাইডার',
    faq: [
      { q: 'ভোল্টেজ ডিভাইডারের সূত্র কী?', a: 'Vout = Vin × R2 ÷ (R1 + R2)। R2 হলো নিচের (GND-এর দিকের) রেজিস্টর।' },
      { q: '৫V থেকে ৩.৩V কীভাবে বানাব?', a: 'R1 = ১kΩ আর R2 = ২kΩ নিলে Vout = ৫ × ২ ÷ ৩ ≈ ৩.৩৩V — HC-05 ব্লুটুথের RX পিনের জন্য এটাই চলে।' },
      { q: 'ভোল্টেজ ডিভাইডার দিয়ে মোটর বা মডিউল চালানো যায়?', a: 'না। এটা শুধু সংকেত কমানো বা সেন্সর পড়ার জন্য। লোড লাগালে ভোল্টেজ পড়ে যায় — পাওয়ারের জন্য রেগুলেটর (যেমন 7805, AMS1117) ব্যবহার করুন।' },
    ],
  },
  'series-parallel': {
    en: 'Series & Parallel Resistor and Capacitor Calculator',
    keywords: 'series parallel resistor calculator, parallel resistor calculator, capacitor series parallel, সিরিজ প্যারালাল রেজিস্টর',
    faq: [
      { q: 'সিরিজে রেজিস্টরের মোট মান কত?', a: 'সব যোগ হয়: R = R1 + R2 + … যেমন ১kΩ + ২.২kΩ = ৩.২kΩ।' },
      { q: 'দুইটা ১kΩ প্যারালালে দিলে কত হয়?', a: '১/R = ১/১০০০ + ১/১০০০, তাই R = ৫০০Ω। সমান দুইটা প্যারালালে দিলে মান অর্ধেক হয়।' },
      { q: 'ক্যাপাসিটরের নিয়ম কি একই?', a: 'উল্টো: ক্যাপাসিটর প্যারালালে যোগ হয় (C = C1 + C2), আর সিরিজে ১/C = ১/C1 + ১/C2।' },
    ],
  },
  'transistor-switch': {
    en: 'Transistor Switch Calculator & Pinout Chart (BC547, 2N2222, TIP120)',
    keywords: 'bc547 pinout, transistor pinout, 2n2222 pinout, tip120 pinout, transistor base resistor calculator, ট্রানজিস্টর পিন',
    faq: [
      { q: 'BC547-এর পিন কোনটা কী?', a: 'চ্যাপ্টা দিকটা নিজের দিকে রেখে পা নিচে রাখলে বাম থেকে: C (কালেক্টর), B (বেস), E (এমিটার)।' },
      { q: 'BC547 NPN না PNP?', a: 'BC547 হলো NPN, সর্বোচ্চ ১০০mA কারেন্ট। এর PNP জোড়া হলো BC557।' },
      { q: '2N2222A-এর পিন কী?', a: 'চ্যাপ্টা দিক সামনে রেখে বাম থেকে: E, B, C — BC547-এর উল্টো, তাই বদলানোর আগে মিলিয়ে নিন।' },
      { q: 'আরডুইনো দিয়ে রিলে চালাতে বেসে কত ওহম?', a: 'সাধারণ ৫V রিলেতে BC547-এর বেসে ১kΩ সাধারণত চলে। নিজের রিলের কারেন্ট দিয়ে উপরের টুলে হিসাব করে নিন, আর রিলের কয়েলে উল্টো করে একটা 1N4007 ডায়োড দিন।' },
    ],
  },
  '555-timer': {
    en: '555 Timer Calculator (Astable & Monostable)',
    keywords: '555 timer calculator, ne555 astable calculator, 555 frequency calculator, monostable 555, ৫৫৫ টাইমার',
    faq: [
      { q: '555 Astable-এর ফ্রিকোয়েন্সির সূত্র কী?', a: 'f = ১.৪৪ ÷ ((R1 + ২×R2) × C)। ডিউটি সাইকেল = (R1 + R2) ÷ (R1 + ২×R2)।' },
      { q: 'R1 = ১kΩ, R2 = ১০kΩ, C = ১০µF হলে LED কত দ্রুত জ্বলবে?', a: 'f = ১.৪৪ ÷ (২১,০০০ × ০.০০০০১) ≈ ৬.৯Hz — সেকেন্ডে প্রায় ৭ বার, ডিউটি প্রায় ৫২%।' },
      { q: 'Monostable 555-এ সময় কত?', a: 'T = ১.১ × R × C। যেমন R = ১০০kΩ, C = ১০০µF হলে T ≈ ১১ সেকেন্ড।' },
    ],
  },
  'battery-life': {
    en: 'Battery Life Calculator (mAh to Hours)',
    keywords: 'battery life calculator, mah to hours, 18650 battery life, battery runtime calculator, ব্যাটারি কতক্ষণ চলবে',
    faq: [
      { q: 'ব্যাটারি কতক্ষণ চলবে হিসাব কী?', a: 'ঘণ্টা = ব্যাটারির mAh ÷ প্রজেক্টের কারেন্ট (mA)। বাস্তবে এর ৭০–৮০% ধরুন।' },
      { q: '২০০০mAh ব্যাটারি ১০০mA-তে কতক্ষণ চলবে?', a: 'হিসাবে ২০ ঘণ্টা, বাস্তবে প্রায় ১৪–১৬ ঘণ্টা।' },
      { q: 'দুইটা 18650 সিরিজে আর প্যারালালে দিলে কী হয়?', a: 'সিরিজে ভোল্টেজ যোগ হয় (৩.৭V + ৩.৭V = ৭.৪V), mAh একই থাকে। প্যারালালে mAh যোগ হয়, ভোল্টেজ একই (৩.৭V)।' },
    ],
  },
};

export const LESSON_SEO: Record<string, SeoInfo> = {
  'voltage-current-resistance': {
    en: 'Voltage, Current & Resistance Basics',
    keywords: 'voltage current resistance bangla, ভোল্টেজ কি, কারেন্ট কি, রেজিস্ট্যান্স কি, ইলেকট্রনিক্স বেসিক',
    faq: [
      { q: 'ভোল্টেজ আর কারেন্টের পার্থক্য কী?', a: 'ভোল্টেজ হলো ধাক্কা বা চাপ (ভোল্ট, V), কারেন্ট হলো কতটা বিদ্যুৎ বয়ে যাচ্ছে (অ্যাম্পিয়ার, A)। পানির পাইপের চাপ আর পানির প্রবাহের মতো।' },
      { q: 'রেজিস্ট্যান্স কী?', a: 'কারেন্টের পথে বাধা, মাপা হয় ওহমে (Ω)। বাধা বেশি হলে একই ভোল্টেজে কারেন্ট কম যায় — V = I × R।' },
    ],
  },
  'led-resistor-first-circuit': {
    en: 'LED & Resistor — Your First Circuit',
    keywords: 'first led circuit bangla, led resistor circuit, LED সার্কিট, প্রথম সার্কিট',
    faq: [
      { q: 'LED-এর কোন পা প্লাস?', a: 'লম্বা পা প্লাস (অ্যানোড), ছোট পা মাইনাস (ক্যাথোড)। LED-এর গায়ের চ্যাপ্টা দিকটাও মাইনাস।' },
      { q: '৫V-এ LED জ্বালাতে কত ওহম রেজিস্টর?', a: 'সাধারণ লাল LED-এর জন্য ২২০Ω নিরাপদ — কারেন্ট প্রায় ১৪mA থাকে।' },
    ],
  },
  'breadboard-multimeter': {
    en: 'Breadboard & Multimeter Basics',
    keywords: 'breadboard bangla, multimeter use bangla, how to use multimeter, ব্রেডবোর্ড, মাল্টিমিটার ব্যবহার',
    faq: [
      { q: 'ব্রেডবোর্ডের কোন ছিদ্রগুলো জোড়া থাকে?', a: 'মাঝের অংশে প্রতিটা ছোট খাড়া সারির ৫টা ছিদ্র ভেতরে জোড়া। পাশের লম্বা লাল-নীল লাইন দুইটা পাওয়ার (+ আর −) এর জন্য।' },
      { q: 'মাল্টিমিটারে কারেন্ট মাপতে সাবধানতা কী?', a: 'কারেন্ট মাপতে মিটার সিরিজে বসাতে হয়, আর লাল তার A/mA ছিদ্রে। ওই অবস্থায় ব্যাটারির দুই মাথায় সরাসরি ধরলে মিটারের ফিউজ পুড়ে যায়।' },
    ],
  },
  'soldering-basics': {
    en: 'Soldering Basics for Beginners',
    keywords: 'soldering bangla, how to solder, soldering iron tips, সোল্ডারিং শেখা',
    faq: [
      { q: 'শুরুর জন্য কত ওয়াটের সোল্ডারিং আয়রন ভালো?', a: 'ছোট ইলেকট্রনিক্সের কাজে ৩০–৬০W আয়রন যথেষ্ট, তাপমাত্রা ঠিক করা গেলে আরও ভালো।' },
      { q: 'ভালো সোল্ডার জোড়া দেখতে কেমন?', a: 'চকচকে, ছোট পাহাড়ের মতো মসৃণ, পা আর প্যাড দুইটাকেই ঢেকে রাখে। ধূসর দলা বা বল হলে জোড়া ঠান্ডা — আবার গরম করুন।' },
    ],
  },
  'arduino-first-program': {
    en: 'Arduino Tutorial for Beginners — Blink LED',
    keywords: 'arduino bangla tutorial, arduino blink, arduino uno beginner, আরডুইনো শেখা, আরডুইনো প্রোগ্রাম',
    faq: [
      { q: 'আরডুইনো প্রোগ্রাম কোথায় লিখব?', a: 'কম্পিউটারে ফ্রি Arduino IDE নামিয়ে সেখানে লিখে USB দিয়ে বোর্ডে আপলোড করুন।' },
      { q: 'setup() আর loop() কী?', a: 'setup() একবার চলে শুরুতে (যেমন পিন ঠিক করা), loop() বারবার চলতেই থাকে (যেমন LED জ্বালানো-নেভানো)।' },
    ],
  },
  'sensors-ldr-ir-ultrasonic': {
    en: 'Arduino Sensors — LDR, IR & Ultrasonic (HC-SR04)',
    keywords: 'arduino sensor bangla, ldr sensor, ir sensor, hc-sr04 ultrasonic sensor, সেন্সর',
    faq: [
      { q: 'আল্ট্রাসনিক সেন্সর দূরত্ব কীভাবে মাপে?', a: 'শব্দ পাঠিয়ে প্রতিধ্বনি ফিরে আসার সময় মাপে। দূরত্ব (cm) ≈ সময় (µs) ÷ ৫৮।' },
      { q: 'LDR কী কাজ করে?', a: 'আলো বাড়লে এর রেজিস্ট্যান্স কমে যায়। একটা রেজিস্টরের সাথে ভোল্টেজ ডিভাইডার বানিয়ে আরডুইনোর A0 পিনে আলো মাপা যায়।' },
    ],
  },
  'transistor-relay-switch': {
    en: 'Transistor & Relay as a Switch',
    keywords: 'transistor as switch bangla, relay module arduino, bc547 relay, ট্রানজিস্টর সুইচ, রিলে',
    faq: [
      { q: 'আরডুইনোর পিন দিয়ে সরাসরি রিলে চালানো যায় না কেন?', a: 'রিলের কয়েলে পিনের নিরাপদ সীমার চেয়ে বেশি কারেন্ট লাগে। মাঝে ট্রানজিস্টর দিলে ছোট কারেন্ট দিয়ে বড় কারেন্ট চালু-বন্ধ করা যায়।' },
      { q: 'রিলের সাথে ডায়োড কেন দিতে হয়?', a: 'কয়েল বন্ধ হওয়ার সময় উল্টো ভোল্টেজের ঝাঁকি দেয়, ডায়োড (যেমন 1N4007) সেটা থামিয়ে ট্রানজিস্টর বাঁচায়।' },
    ],
  },
  'motors-l298n-servo': {
    en: 'Motor Control — L298N Driver & Servo Motor',
    keywords: 'l298n motor driver bangla, servo motor arduino, dc motor control, মোটর ড্রাইভার',
    faq: [
      { q: 'মোটর সরাসরি আরডুইনোতে লাগানো যায়?', a: 'না। মোটর অনেক কারেন্ট টানে আর পিন নষ্ট করতে পারে। L298N-এর মতো মোটর ড্রাইভার দিয়ে চালান।' },
      { q: 'সার্ভো মোটরের তিনটা তার কী?', a: 'সাধারণত বাদামি/কালো = GND, লাল = +৫V, কমলা/হলুদ = সংকেত (আরডুইনোর পিন)।' },
    ],
  },
  'batteries-charging-power': {
    en: '18650 Battery, TP4056 Charger & 7805 Regulator',
    keywords: '18650 battery bangla, tp4056 charger module, 7805 regulator, battery charging, ব্যাটারি চার্জিং',
    faq: [
      { q: 'TP4056 কী?', a: 'একটা ছোট মডিউল যা ৫V (USB) দিয়ে একটা ৩.৭V লিথিয়াম সেল (যেমন 18650) নিরাপদে ৪.২V পর্যন্ত চার্জ করে।' },
      { q: '7805 কী কাজ করে?', a: '৭V বা তার বেশি ইনপুট থেকে স্থির ৫V দেয় (সর্বোচ্চ প্রায় ১A)। বেশি কারেন্টে গরম হয়, তাই হিটসিঙ্ক লাগে।' },
    ],
  },
  'line-follower-robot-car': {
    en: 'Line Follower Robot Car with Arduino',
    keywords: 'line follower robot bangla, arduino robot car, line follower sensor, লাইন ফলোয়ার রোবট',
    faq: [
      { q: 'লাইন ফলোয়ার রোবট কীভাবে লাইন চেনে?', a: 'নিচে লাগানো IR সেন্সর সাদা মেঝে থেকে আলো ফেরত পায়, কালো লাইন থেকে পায় না — সেটা দেখে আরডুইনো মোটর ঘোরায়।' },
      { q: 'লাইন ফলোয়ার বানাতে কী কী লাগে?', a: 'আরডুইনো, ২টা IR সেন্সর, L298N মোটর ড্রাইভার, ২টা গিয়ার মোটর আর চাকা, চ্যাসিস আর ব্যাটারি।' },
    ],
  },
};

/** "<English> — <Bangla>" for the page title: the words people type first, then the Bangla name. */
export function seoTitle(en: string, bangla: string): string {
  return `${en} — ${bangla}`;
}

/** schema.org FAQPage for Google and AI answers — only the questions shown on the page itself. */
export function faqLd(faq: Faq[]) {
  return { '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })) };
}

/** 🔗 Product pages → the free tool that fits the part (owner, 2026-11-28): "এই রেজিস্টরের রং দেখুন → টুল". */
const HINTS: { key: string; label: string; test: RegExp; not?: RegExp }[] = [
  { key: 'resistor-color-code', label: 'রেজিস্টরের রং দেখে মান বের করুন', test: /resistor|রেজিস্ট/i, not: /variable|potentiometer|\bpot\b|preset|trimmer|thermistor|ntc|ptc|ldr|photo|smd|0805|0603|1206|0402|network|array|sip/i },
  { key: 'smd-resistor-code', label: 'SMD রেজিস্টরের কোড পড়ুন', test: /(smd|0805|0603|1206|0402).*(resistor|রেজিস্ট)|(resistor|রেজিস্ট).*(smd|0805|0603|1206|0402)/i },
  { key: 'capacitor-code', label: 'ক্যাপাসিটরের কোড (104, 103…) থেকে মান', test: /capacitor|ক্যাপাসিটর/i },
  { key: 'led-resistor', label: 'এই LED-এ কত ওহম রেজিস্টর লাগবে', test: /\bled\b|এলইডি/i, not: /strip|bulb|lamp|light|panel|matrix|display|driver|tv|torch|flood|tube|module|ring|bar|neon|cob|rgb strip|dot/i },
  { key: 'transistor-switch', label: 'ট্রানজিস্টরের পিন আর বেস রেজিস্টর', test: /transistor|mosfet|ট্রানজিস্টর|\bBC5[45]\d|\b2N(2222|3904|3906|7000)|\bS8[05]50\b|\bBD13\d|\bTIP1?\d\d|IRFZ44/i },
  { key: '555-timer', label: '555 টাইমারের হিসাব', test: /\bne?555\b|\b555 timer/i },
  { key: 'battery-life', label: 'ব্যাটারি কতক্ষণ চলবে', test: /18650|li-?ion|lipo|battery|ব্যাটারি/i, not: /charger|tester|spot weld|indicator/i },
];
export function toolsForProduct(text: string, enabled: string[]): { key: string; label: string }[] {
  const t = String(text || '');
  return HINTS.filter((h) => enabled.includes(h.key) && h.test.test(t) && !(h.not && h.not.test(t))).slice(0, 2).map(({ key, label }) => ({ key, label }));
}
