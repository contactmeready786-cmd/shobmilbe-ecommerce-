// 🇧🇩 বাংলা নাম (owner, 2026-10-24): every product's English name gets a Bangla name, written the way people in
// Bangladesh say these things — "Soldering Iron" is "সোল্ডারিং আয়রন" (never "ঝালাই লোহা"), "Amplifier Board" is
// "অ্যামপ্লিফায়ার বোর্ড" (never "পরিবর্ধক তক্তা"). No machine translation: a fixed word list, so the same name always
// gives the same Bangla and nothing odd can slip in. What isn't in the list — brand names, model numbers, sizes
// (Kemei, DT9205A, 60W, 12V) — stays exactly as written. The owner can change any Bangla name on the product form.
//
//   bnTitle("Digital Multimeter DT9205A")            → "ডিজিটাল মাল্টিমিটার DT9205A"
//   bnTitle("Soldering Iron 60W with Stand")         → "স্ট্যান্ড সহ সোল্ডারিং আয়রন 60W"
//   bnTitle("5V Relay Module for Arduino")           → "Arduino-এর জন্য 5V রিলে মডিউল"
//   bnTitle("10 Pcs 1N4007 Diode")                   → "10 পিস 1N4007 ডায়োড"

/** several words that go together (looked for first, longest first) */
const PHRASES: Record<string, string> = {
  'soldering iron': 'সোল্ডারিং আয়রন', 'soldering station': 'সোল্ডারিং স্টেশন', 'desoldering pump': 'ডিসোল্ডারিং পাম্প', 'solder wire': 'সোল্ডার তার',
  'solder sucker': 'সোল্ডার সাকার', 'hot air gun': 'হট এয়ার গান', 'heat gun': 'হিট গান', 'glue gun': 'গ্লু গান', 'hot glue': 'হট গ্লু', 'glue stick': 'গ্লু স্টিক',
  'power bank': 'পাওয়ার ব্যাংক', 'power supply': 'পাওয়ার সাপ্লাই', 'power adapter': 'পাওয়ার অ্যাডাপ্টার', 'power cable': 'পাওয়ার ক্যাবল', 'power strip': 'মাল্টিপ্লাগ',
  'extension cord': 'এক্সটেনশন কর্ড', 'multi plug': 'মাল্টিপ্লাগ', 'wall charger': 'ওয়াল চার্জার', 'car charger': 'কার চার্জার', 'fast charger': 'ফাস্ট চার্জার',
  'data cable': 'ডাটা ক্যাবল', 'usb cable': 'USB ক্যাবল', 'charging cable': 'চার্জিং ক্যাবল', 'jumper wire': 'জাম্পার তার', 'jumper wires': 'জাম্পার তার',
  'bread board': 'ব্রেডবোর্ড', 'pcb board': 'PCB বোর্ড', 'dot board': 'ডট বোর্ড', 'development board': 'ডেভেলপমেন্ট বোর্ড', 'amplifier board': 'অ্যামপ্লিফায়ার বোর্ড',
  'circuit board': 'সার্কিট বোর্ড', 'control board': 'কন্ট্রোল বোর্ড', 'driver board': 'ড্রাইভার বোর্ড', 'charging module': 'চার্জিং মডিউল',
  'step down': 'স্টেপ ডাউন', 'step up': 'স্টেপ আপ', 'buck converter': 'বাক কনভার্টার', 'boost converter': 'বুস্ট কনভার্টার',
  'solar panel': 'সোলার প্যানেল', 'solar light': 'সোলার লাইট', 'charge controller': 'চার্জ কন্ট্রোলার', 'led strip': 'LED স্ট্রিপ', 'led light': 'LED লাইট',
  'led bulb': 'LED বাল্ব', 'rgb led': 'RGB LED', 'street light': 'স্ট্রিট লাইট', 'flood light': 'ফ্লাড লাইট', 'emergency light': 'ইমার্জেন্সি লাইট', 'torch light': 'টর্চ লাইট',
  'night light': 'নাইট লাইট', 'table lamp': 'টেবিল ল্যাম্প', 'ceiling fan': 'সিলিং ফ্যান', 'table fan': 'টেবিল ফ্যান', 'exhaust fan': 'এক্সহস্ট ফ্যান', 'cooling fan': 'কুলিং ফ্যান',
  'dc motor': 'DC মোটর', 'servo motor': 'সার্ভো মোটর', 'stepper motor': 'স্টেপার মোটর', 'gear motor': 'গিয়ার মোটর', 'water pump': 'পানির পাম্প',
  'clamp meter': 'ক্ল্যাম্প মিটার', 'digital meter': 'ডিজিটাল মিটার', 'volt meter': 'ভোল্ট মিটার', 'voltage tester': 'ভোল্টেজ টেস্টার', 'tester screwdriver': 'টেস্টার স্ক্রুড্রাইভার',
  'screwdriver set': 'স্ক্রুড্রাইভার সেট', 'tool kit': 'টুল কিট', 'tool set': 'টুল সেট', 'tool box': 'টুল বক্স', 'wire stripper': 'তার ছোলার প্লাস', 'wire cutter': 'তার কাটার প্লাস',
  'cutting plier': 'কাটিং প্লাস', 'nose plier': 'নোজ প্লাস', 'long nose': 'লং নোজ', 'magnifying glass': 'ম্যাগনিফায়িং গ্লাস', 'measuring tape': 'মাপার ফিতা',
  'electrical tape': 'ইলেকট্রিক টেপ', 'insulation tape': 'ইনসুলেশন টেপ', 'double sided tape': 'ডাবল সাইড টেপ', 'heat shrink': 'হিট শ্রিংক', 'heat sink': 'হিট সিংক',
  'cable tie': 'ক্যাবল টাই', 'cable ties': 'ক্যাবল টাই', 'battery holder': 'ব্যাটারি হোল্ডার', 'battery charger': 'ব্যাটারি চার্জার', 'lithium battery': 'লিথিয়াম ব্যাটারি',
  'rechargeable battery': 'রিচার্জেবল ব্যাটারি', 'li ion': 'লিথিয়াম আয়ন', 'lithium ion': 'লিথিয়াম আয়ন', 'lead acid': 'লেড এসিড',
  'remote control': 'রিমোট কন্ট্রোল', 'remote controller': 'রিমোট কন্ট্রোলার', 'push button': 'পুশ বাটন', 'push switch': 'পুশ সুইচ', 'toggle switch': 'টগল সুইচ',
  'rocker switch': 'রকার সুইচ', 'slide switch': 'স্লাইড সুইচ', 'limit switch': 'লিমিট সুইচ', 'micro switch': 'মাইক্রো সুইচ', 'reed switch': 'রিড সুইচ', 'touch switch': 'টাচ সুইচ',
  'smart switch': 'স্মার্ট সুইচ', 'wall switch': 'ওয়াল সুইচ', 'circuit breaker': 'সার্কিট ব্রেকার', 'fuse holder': 'ফিউজ হোল্ডার', 'terminal block': 'টার্মিনাল ব্লক',
  'ir sensor': 'IR সেন্সর', 'ultrasonic sensor': 'আল্ট্রাসনিক সেন্সর', 'motion sensor': 'মোশন সেন্সর', 'temperature sensor': 'তাপমাত্রা সেন্সর', 'humidity sensor': 'আর্দ্রতা সেন্সর',
  'soil moisture': 'মাটির আর্দ্রতা', 'gas sensor': 'গ্যাস সেন্সর', 'sound sensor': 'সাউন্ড সেন্সর', 'light sensor': 'লাইট সেন্সর', 'water level': 'পানির লেভেল',
  'sound box': 'সাউন্ড বক্স', 'bluetooth speaker': 'ব্লুটুথ স্পিকার', 'wireless mouse': 'ওয়্যারলেস মাউস', 'gaming mouse': 'গেমিং মাউস', 'mouse pad': 'মাউস প্যাড',
  'memory card': 'মেমোরি কার্ড', 'sd card': 'SD কার্ড', 'card reader': 'কার্ড রিডার', 'pen drive': 'পেনড্রাইভ', 'flash drive': 'ফ্ল্যাশ ড্রাইভ', 'hard disk': 'হার্ড ডিস্ক',
  'smart watch': 'স্মার্ট ওয়াচ', 'phone holder': 'ফোন হোল্ডার', 'mobile holder': 'মোবাইল হোল্ডার', 'mobile stand': 'মোবাইল স্ট্যান্ড', 'screen protector': 'স্ক্রিন প্রোটেক্টর',
  'back cover': 'ব্যাক কভার', 'phone case': 'ফোন কেস', 'selfie stick': 'সেলফি স্টিক', 'ring light': 'রিং লাইট', 'hair trimmer': 'হেয়ার ট্রিমার', 'hair dryer': 'হেয়ার ড্রায়ার',
  'hair straightener': 'হেয়ার স্ট্রেইটনার', 'electric kettle': 'ইলেকট্রিক কেটলি', 'rice cooker': 'রাইস কুকার', 'water heater': 'ওয়াটার হিটার', 'room heater': 'রুম হিটার',
  'air cooler': 'এয়ার কুলার', 'water filter': 'পানির ফিল্টার', 'cctv camera': 'CCTV ক্যামেরা', 'ip camera': 'IP ক্যামেরা', 'wifi camera': 'ওয়াইফাই ক্যামেরা',
  'wifi router': 'ওয়াইফাই রাউটার', 'network cable': 'নেটওয়ার্ক ক্যাবল', 'hdmi cable': 'HDMI ক্যাবল', 'aux cable': 'AUX ক্যাবল', 'otg adapter': 'OTG অ্যাডাপ্টার',
  'type c': 'টাইপ-সি', 'micro usb': 'মাইক্রো USB', 'lcd display': 'LCD ডিসপ্লে', 'oled display': 'OLED ডিসপ্লে', 'touch screen': 'টাচ স্ক্রিন', 'seven segment': 'সেভেন সেগমেন্ট',
  'real time clock': 'রিয়েল টাইম ক্লক', 'starter kit': 'স্টার্টার কিট', 'learning kit': 'লার্নিং কিট', 'diy kit': 'DIY কিট', 'robot car': 'রোবট কার', 'robot kit': 'রোবট কিট',
  'smart car': 'স্মার্ট কার', 'drone motor': 'ড্রোন মোটর', 'rc car': 'RC কার', 'propeller': 'প্রপেলার', 'test lead': 'টেস্ট লিড', 'test leads': 'টেস্ট লিড',
  'alligator clip': 'কুমির ক্লিপ', 'crocodile clip': 'কুমির ক্লিপ', 'banana plug': 'বানানা প্লাগ', 'dc jack': 'DC জ্যাক', 'audio jack': 'অডিও জ্যাক', 'pin header': 'পিন হেডার',
  'male to male': 'মেল টু মেল', 'male to female': 'মেল টু ফিমেল', 'female to female': 'ফিমেল টু ফিমেল', 'high quality': 'উন্নত মানের', 'best quality': 'সেরা মানের',
  'high power': 'হাই পাওয়ার', 'low power': 'লো পাওয়ার', 'high speed': 'হাই স্পিড', 'fast charging': 'ফাস্ট চার্জিং', 'long lasting': 'দীর্ঘস্থায়ী',
  'heavy duty': 'হেভি ডিউটি', 'water proof': 'ওয়াটারপ্রুফ', 'dust proof': 'ডাস্টপ্রুফ', 'all in one': 'অল-ইন-ওয়ান', 'plug and play': 'প্লাগ অ্যান্ড প্লে',
  'auto cut': 'অটো কাট', 'auto off': 'অটো অফ', 'ac to dc': 'AC থেকে DC', 'dc to dc': 'DC থেকে DC', 'dc to ac': 'DC থেকে AC',
  'single channel': 'সিঙ্গেল চ্যানেল', 'dual channel': 'ডুয়াল চ্যানেল', 'double channel': 'ডাবল চ্যানেল', 'two channel': '২ চ্যানেল', 'four channel': '৪ চ্যানেল',
  'mosquito killer bat': 'মশা মারার ব্যাট', 'mosquito bat': 'মশা মারার ব্যাট', 'mosquito killer': 'মশা মারার মেশিন', 'stand alone': 'স্ট্যান্ড-অ্যালোন', 'mini size': 'মিনি সাইজ', 'small size': 'ছোট সাইজ', 'big size': 'বড় সাইজ', 'full set': 'পুরো সেট', 'combo pack': 'কম্বো প্যাক',
};

/** single words */
const WORDS: Record<string, string> = {
  // tools and meters
  multimeter: 'মাল্টিমিটার', meter: 'মিটার', tester: 'টেস্টার', soldering: 'সোল্ডারিং', solder: 'সোল্ডার', desoldering: 'ডিসোল্ডারিং', iron: 'আয়রন', flux: 'ফ্লাক্স',
  paste: 'পেস্ট', tip: 'টিপ', tips: 'টিপ', station: 'স্টেশন', stand: 'স্ট্যান্ড', holder: 'হোল্ডার', plier: 'প্লাস', pliers: 'প্লাস', cutter: 'কাটার', stripper: 'স্ট্রিপার',
  screwdriver: 'স্ক্রুড্রাইভার', screwdrivers: 'স্ক্রুড্রাইভার', screw: 'স্ক্রু', screws: 'স্ক্রু', nut: 'নাট', nuts: 'নাট', bolt: 'বোল্ট', bolts: 'বোল্ট', spacer: 'স্পেসার', washer: 'ওয়াশার',
  drill: 'ড্রিল', bit: 'বিট', bits: 'বিট', hammer: 'হাতুড়ি', wrench: 'রেঞ্চ', spanner: 'স্প্যানার', saw: 'করাত', knife: 'ছুরি', blade: 'ব্লেড', blades: 'ব্লেড', scissors: 'কাঁচি',
  tweezer: 'চিমটা', tweezers: 'চিমটা', clamp: 'ক্ল্যাম্প', vise: 'ভাইস', magnifier: 'ম্যাগনিফায়ার', tape: 'টেপ', glue: 'গ্লু', gun: 'গান', brush: 'ব্রাশ', file: 'ফাইল',
  oscilloscope: 'অসিলোস্কোপ', thermometer: 'থার্মোমিটার', hygrometer: 'হাইগ্রোমিটার', voltmeter: 'ভোল্টমিটার', ammeter: 'অ্যামিটার', wattmeter: 'ওয়াটমিটার', probe: 'প্রোব', probes: 'প্রোব',
  // parts
  board: 'বোর্ড', module: 'মডিউল', modules: 'মডিউল', sensor: 'সেন্সর', sensors: 'সেন্সর', relay: 'রিলে', resistor: 'রেজিস্টর', resistors: 'রেজিস্টর', capacitor: 'ক্যাপাসিটর',
  capacitors: 'ক্যাপাসিটর', diode: 'ডায়োড', diodes: 'ডায়োড', transistor: 'ট্রানজিস্টর', transistors: 'ট্রানজিস্টর', mosfet: 'মসফেট', regulator: 'রেগুলেটর', inductor: 'ইন্ডাক্টর',
  potentiometer: 'পোটেনশিওমিটার', pot: 'পট', preset: 'প্রিসেট', ic: 'IC', chip: 'চিপ', socket: 'সকেট', crystal: 'ক্রিস্টাল', oscillator: 'অসিলেটর', transformer: 'ট্রান্সফরমার',
  breadboard: 'ব্রেডবোর্ড', veroboard: 'ভেরোবোর্ড', pcb: 'PCB', header: 'হেডার', headers: 'হেডার', pin: 'পিন', pins: 'পিন', connector: 'কানেক্টর', connectors: 'কানেক্টর',
  terminal: 'টার্মিনাল', terminals: 'টার্মিনাল', jack: 'জ্যাক', plug: 'প্লাগ', plugs: 'প্লাগ', clip: 'ক্লিপ', clips: 'ক্লিপ', fuse: 'ফিউজ', fuses: 'ফিউজ', buzzer: 'বাজার',
  speaker: 'স্পিকার', speakers: 'স্পিকার', microphone: 'মাইক্রোফোন', mic: 'মাইক', amplifier: 'অ্যামপ্লিফায়ার', amp: 'অ্যাম্প', display: 'ডিসপ্লে', screen: 'স্ক্রিন', lcd: 'LCD',
  oled: 'OLED', led: 'LED', leds: 'LED', bulb: 'বাল্ব', bulbs: 'বাল্ব', lamp: 'ল্যাম্প', lamps: 'ল্যাম্প', light: 'লাইট', lights: 'লাইট', strip: 'স্ট্রিপ', tube: 'টিউব',
  motor: 'মোটর', motors: 'মোটর', pump: 'পাম্প', fan: 'ফ্যান', fans: 'ফ্যান', wheel: 'চাকা', wheels: 'চাকা', gear: 'গিয়ার', gears: 'গিয়ার', propellers: 'প্রপেলার', servo: 'সার্ভো',
  encoder: 'এনকোডার', keypad: 'কিপ্যাড', keyboard: 'কিবোর্ড', joystick: 'জয়স্টিক', button: 'বাটন', buttons: 'বাটন', switch: 'সুইচ', switches: 'সুইচ', knob: 'নব',
  breaker: 'ব্রেকার', contactor: 'কন্টাক্টর', timer: 'টাইমার', counter: 'কাউন্টার', controller: 'কন্ট্রোলার', driver: 'ড্রাইভার', inverter: 'ইনভার্টার', converter: 'কনভার্টার',
  adapter: 'অ্যাডাপ্টার', adaptor: 'অ্যাডাপ্টার', charger: 'চার্জার', chargers: 'চার্জার', battery: 'ব্যাটারি', batteries: 'ব্যাটারি', cell: 'সেল', cells: 'সেল', panel: 'প্যানেল',
  cable: 'ক্যাবল', cables: 'ক্যাবল', wire: 'তার', wires: 'তার', cord: 'কর্ড', antenna: 'অ্যান্টেনা', camera: 'ক্যামেরা', lens: 'লেন্স', router: 'রাউটার', receiver: 'রিসিভার',
  transmitter: 'ট্রান্সমিটার', remote: 'রিমোট', heater: 'হিটার', cooler: 'কুলার', kettle: 'কেটলি', trimmer: 'ট্রিমার', shaver: 'শেভার', dryer: 'ড্রায়ার',
  straightener: 'স্ট্রেইটনার', blender: 'ব্লেন্ডার', mixer: 'মিক্সার', grinder: 'গ্রাইন্ডার', juicer: 'জুসার', oven: 'ওভেন', cooker: 'কুকার', stove: 'চুলা', geyser: 'গিজার',
  mouse: 'মাউস', headphone: 'হেডফোন', headphones: 'হেডফোন', earphone: 'ইয়ারফোন', earphones: 'ইয়ারফোন', earbuds: 'ইয়ারবাডস', headset: 'হেডসেট', watch: 'ঘড়ি', clock: 'ঘড়ি',
  calculator: 'ক্যালকুলেটর', torch: 'টর্চ', flashlight: 'টর্চলাইট', drone: 'ড্রোন', robot: 'রোবট', car: 'কার', toy: 'খেলনা', toys: 'খেলনা',
  kit: 'কিট', kits: 'কিট', set: 'সেট', sets: 'সেট', box: 'বক্স', case: 'কেস', cover: 'কভার', bag: 'ব্যাগ', pouch: 'পাউচ', enclosure: 'এনক্লোজার', frame: 'ফ্রেম', chassis: 'চেসিস',
  sheet: 'শিট', plate: 'প্লেট', rod: 'রড', pipe: 'পাইপ', sleeve: 'স্লিভ', tie: 'টাই', ties: 'টাই', label: 'লেবেল', sticker: 'স্টিকার', stickers: 'স্টিকার', magnet: 'চুম্বক',
  spring: 'স্প্রিং', bearing: 'বিয়ারিং', belt: 'বেল্ট', chain: 'চেইন', hook: 'হুক', mount: 'মাউন্ট', bracket: 'ব্র্যাকেট', base: 'বেস', tray: 'ট্রে', mat: 'ম্যাট', pad: 'প্যাড',
  // kinds and features
  digital: 'ডিজিটাল', analog: 'অ্যানালগ', analogue: 'অ্যানালগ', electric: 'ইলেকট্রিক', electrical: 'ইলেকট্রিক্যাল', electronic: 'ইলেকট্রনিক', electronics: 'ইলেকট্রনিক্স',
  automatic: 'অটোমেটিক', auto: 'অটো', manual: 'ম্যানুয়াল', smart: 'স্মার্ট', wireless: 'ওয়্যারলেস', wired: 'তারযুক্ত', bluetooth: 'ব্লুটুথ', wifi: 'ওয়াইফাই', 'wi-fi': 'ওয়াইফাই',
  usb: 'USB', solar: 'সোলার', rechargeable: 'রিচার্জেবল', portable: 'পোর্টেবল', mini: 'মিনি', micro: 'মাইক্রো', small: 'ছোট', big: 'বড়', large: 'বড়', medium: 'মাঝারি',
  long: 'লম্বা', short: 'ছোট', thin: 'পাতলা', thick: 'মোটা', flexible: 'ফ্লেক্সিবল', adjustable: 'অ্যাডজাস্টেবল', waterproof: 'ওয়াটারপ্রুফ', dustproof: 'ডাস্টপ্রুফ',
  professional: 'প্রফেশনাল', original: 'অরিজিনাল', genuine: 'অরিজিনাল', premium: 'প্রিমিয়াম', standard: 'স্ট্যান্ডার্ড', universal: 'ইউনিভার্সাল', multifunction: 'মাল্টিফাংশন',
  multifunctional: 'মাল্টিফাংশনাল', multipurpose: 'মাল্টিপারপাস', durable: 'টেকসই', strong: 'মজবুত', heavy: 'ভারী', lightweight: 'হালকা',
  new: 'নতুন', latest: 'নতুন', 'high-quality': 'উন্নত মানের', quality: 'মানের', high: 'হাই', low: 'লো', fast: 'ফাস্ট', quick: 'কুইক', super: 'সুপার', ultra: 'আল্ট্রা',
  double: 'ডাবল', dual: 'ডুয়াল', single: 'সিঙ্গেল', triple: 'ট্রিপল', multi: 'মাল্টি', full: 'ফুল', half: 'হাফ', round: 'গোল', square: 'চারকোনা', flat: 'ফ্ল্যাট',
  straight: 'সোজা', curved: 'বাঁকা', angle: 'অ্যাঙ্গেল', transparent: 'স্বচ্ছ', clear: 'স্বচ্ছ', soft: 'নরম', hard: 'শক্ত', metal: 'মেটাল', steel: 'স্টিল', stainless: 'স্টেইনলেস',
  aluminium: 'অ্যালুমিনিয়াম', aluminum: 'অ্যালুমিনিয়াম', copper: 'তামার', plastic: 'প্লাস্টিক', rubber: 'রাবার', silicone: 'সিলিকন', glass: 'কাচ', wooden: 'কাঠের', wood: 'কাঠ',
  leather: 'চামড়া', cotton: 'সুতি', ceramic: 'সিরামিক', magnetic: 'চুম্বকীয়', insulated: 'ইনসুলেটেড', male: 'মেল', female: 'ফিমেল', positive: 'পজিটিভ', negative: 'নেগেটিভ',
  input: 'ইনপুট', output: 'আউটপুট', power: 'পাওয়ার', voltage: 'ভোল্টেজ', current: 'কারেন্ট', volt: 'ভোল্ট', watt: 'ওয়াট', temperature: 'তাপমাত্রা', humidity: 'আর্দ্রতা', water: 'পানি', air: 'এয়ার', gas: 'গ্যাস', sound: 'সাউন্ড', audio: 'অডিও', video: 'ভিডিও', music: 'মিউজিক', home: 'হোম',
  kitchen: 'রান্নাঘরের', office: 'অফিস', outdoor: 'আউটডোর', indoor: 'ইনডোর', travel: 'ট্রাভেল', mobile: 'মোবাইল', phone: 'ফোন', computer: 'কম্পিউটার', laptop: 'ল্যাপটপ',
  tablet: 'ট্যাবলেট', tv: 'টিভি', ac: 'AC', dc: 'DC', rgb: 'RGB', ir: 'IR', rf: 'RF', gps: 'GPS', gsm: 'GSM', lora: 'LoRa', nfc: 'NFC', rfid: 'RFID', ups: 'UPS', ips: 'IPS',
  black: 'কালো', white: 'সাদা', red: 'লাল', blue: 'নীল', green: 'সবুজ', yellow: 'হলুদ', orange: 'কমলা', pink: 'গোলাপি', purple: 'বেগুনি', brown: 'বাদামি', grey: 'ধূসর',
  gray: 'ধূসর', silver: 'সিলভার', golden: 'সোনালি', gold: 'সোনালি', warm: 'ওয়ার্ম', cool: 'কুল', colorful: 'রঙিন', colour: 'রং', color: 'রং',
  // counts, sizes and small words
  pcs: 'পিস', pc: 'পিস', piece: 'পিস', pieces: 'পিস', pack: 'প্যাক', packs: 'প্যাক', packet: 'প্যাকেট', pair: 'জোড়া', pairs: 'জোড়া', roll: 'রোল', rolls: 'রোল',
  meters: 'মিটার', metre: 'মিটার', feet: 'ফুট', foot: 'ফুট', inch: 'ইঞ্চি', inches: 'ইঞ্চি', channel: 'চ্যানেল', channels: 'চ্যানেল', way: 'ওয়ে', port: 'পোর্ট',
  ultrasonic: 'আল্ট্রাসনিক', humidifier: 'হিউমিডিফায়ার', mist: 'মিস্ট', maker: 'মেকার', fogger: 'ফগার', fountain: 'ফোয়ারা', pond: 'পুকুর', egg: 'ডিম',
  incubator: 'ইনকিউবেটর', body: 'বডি', aquarium: 'অ্যাকুরিয়াম', filter: 'ফিল্টার', oxygen: 'অক্সিজেন', cleaner: 'ক্লিনার', vacuum: 'ভ্যাকুয়াম', spray: 'স্প্রে',
  massager: 'ম্যাসাজার', scale: 'স্কেল', weighing: 'ওজন মাপার', printer: 'প্রিন্টার', scanner: 'স্কানার', barcode: 'বারকোড', projector: 'প্রজেক্টর',
  hijab: 'হিজাব', scarf: 'স্কার্ফ', dress: 'ড্রেস', bra: 'ব্রা', panty: 'প্যান্টি', saree: 'শাড়ি', borka: 'বোরকা', burka: 'বোরকা', abaya: 'আবায়া', kurti: 'কুর্তি',
  ports: 'পোর্ট', point: 'পয়েন্ট', points: 'পয়েন্ট', monocrystalline: 'মনোক্রিস্টালাইন', polycrystalline: 'পলিক্রিস্টালাইন', stick: 'স্টিক', sticks: 'স্টিক', gang: 'গ্যাং', phase: 'ফেজ', layer: 'লেয়ার', side: 'সাইড', sided: 'সাইড', size: 'সাইজ', type: 'টাইপ', model: 'মডেল', version: 'ভার্সন', series: 'সিরিজ',
  accessories: 'এক্সেসরিজ', accessory: 'এক্সেসরি', parts: 'পার্টস', part: 'পার্ট', spare: 'স্পেয়ার', replacement: 'রিপ্লেসমেন্ট', extension: 'এক্সটেনশন', tool: 'টুল', tools: 'টুলস',
  machine: 'মেশিন', device: 'ডিভাইস', system: 'সিস্টেম', unit: 'ইউনিট', supply: 'সাপ্লাই', protection: 'প্রটেকশন', protector: 'প্রটেক্টর', guard: 'গার্ড', control: 'কন্ট্রোল',
  monitor: 'মনিটর', indicator: 'ইন্ডিকেটর', alarm: 'অ্যালার্ম', security: 'সিকিউরিটি', lock: 'লক', door: 'দরজার', bell: 'বেল', doorbell: 'কলিং বেল', education: 'শিক্ষামূলক',
  educational: 'শিক্ষামূলক', learning: 'লার্নিং', project: 'প্রজেক্ট', projects: 'প্রজেক্ট', science: 'বিজ্ঞান', student: 'স্টুডেন্ট', students: 'স্টুডেন্ট', kids: 'বাচ্চাদের',
  children: 'বাচ্চাদের', baby: 'বেবি', men: 'ছেলেদের', women: 'মেয়েদের', ladies: 'মেয়েদের', gents: 'ছেলেদের', unisex: 'ইউনিসেক্স',
  // a few everyday shop items
  shirt: 'শার্ট', tshirt: 'টি-শার্ট', 't-shirt': 'টি-শার্ট', pant: 'প্যান্ট', pants: 'প্যান্ট', shoe: 'জুতা', shoes: 'জুতা', sandal: 'স্যান্ডেল', cap: 'ক্যাপ', hat: 'টুপি',
  wallet: 'ওয়ালেট', bottle: 'বোতল', mug: 'মগ', cup: 'কাপ', spoon: 'চামচ', bowl: 'বাটি', jar: 'জার', container: 'কন্টেইনার',
  bucket: 'বালতি', basket: 'ঝুড়ি', mirror: 'আয়না', comb: 'চিরুনি', towel: 'তোয়ালে', pillow: 'বালিশ', mosquito: 'মশা', net: 'নেট', bat: 'ব্যাট', racket: 'র‍্যাকেট', killer: 'কিলার',
};

/** words that join two parts of a name */
const SMALL: Record<string, string> = { and: 'ও', or: 'বা', '&': 'ও', '+': '+', 'in': '', of: '', the: '', a: '', an: '', to: 'থেকে', from: '', by: '' };
/** marketing words a Bangla name doesn't need */
const DROP = new Set(['product', 'products', 'details', 'item', 'items', 'brand', 'bd', 'bangladesh', 'price', 'sale', 'offer', 'hot', 'best', 'top', 'buy', 'online']);

const isCode = (w: string) => /\d/.test(w) || (/^[A-Z][A-Z0-9-]{1,}$/.test(w) && !WORDS[w.toLowerCase()]); // DT9205A, 60W, 12V, PAM8403, HC-SR04, ESP32
const hasBangla = (s: string) => /[ঀ-৿]/.test(s);

/** one stretch of words (no "for" / "with" inside) → Bangla, word by word; phrases first */
function part(text: string): string {
  const toks = text.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (let i = 0; i < toks.length;) {
    // the longest phrase starting here (up to 4 words)
    let hit = '';
    let n = 0;
    for (let k = Math.min(4, toks.length - i); k >= 2; k--) {
      const ph = toks.slice(i, i + k).map((t) => t.toLowerCase().replace(/[^a-z0-9&+-]/g, '')).join(' ');
      const one = ph.endsWith('s') ? ph.slice(0, -1) : ''; // "glue sticks" = "glue stick"
      if (PHRASES[ph] || (one && PHRASES[one])) { hit = PHRASES[ph] || PHRASES[one]; n = k; break; }
    }
    if (hit) { out.push(hit); i += n; continue; }
    const raw = toks[i++];
    const lead = raw.match(/^[("'[]*/)![0], tail = raw.match(/[)"'\],.:;!]*$/)![0];
    const w = raw.slice(lead.length, raw.length - tail.length || undefined);
    if (!w) { if (raw.trim()) out.push(raw); continue; }
    const low = w.toLowerCase();
    let b: string | undefined;
    if (hasBangla(w) || isCode(w)) b = w;
    else if (low in SMALL) b = SMALL[low];
    else if (DROP.has(low)) b = '';
    else if (WORDS[low]) b = WORDS[low];
    else if (low.endsWith('s') && WORDS[low.slice(0, -1)]) b = WORDS[low.slice(0, -1)];
    else if (/^[a-z]+-[a-z]+$/.test(low) && low.split('-').every((x) => WORDS[x])) b = low.split('-').map((x) => WORDS[x]).join('-');
    else b = w; // a brand or a word not in the list: exactly as written
    if (b) out.push(lead + b + tail);
  }
  return out.join(' ').replace(/\s+([,.:;!)])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}

/** "X-এর জন্য": Latin letters / numbers take "-এর"; a Bangla word its own ending (ফোন → ফোনের, ব্যাটারি → ব্যাটারির) */
const forOf = (x: string) => (/[\u0980-\u09FF]$/.test(x) ? `${x}${/[\u09BE-\u09CC]$/.test(x) ? 'র' : 'ের'} জন্য` : `${x}-এর জন্য`);
/** who it is for: "for Men" → "ছেলেদের" in front */
const FOR_WHO: Record<string, string> = { men: 'ছেলেদের', man: 'ছেলেদের', boys: 'ছেলেদের', boy: 'ছেলেদের', gents: 'ছেলেদের', women: 'মেয়েদের', woman: 'মেয়েদের',
  ladies: 'মেয়েদের', girls: 'মেয়েদের', girl: 'মেয়েদের', kids: 'বাচ্চাদের', kid: 'বাচ্চাদের', children: 'বাচ্চাদের', child: 'বাচ্চাদের', baby: 'বেবিদের', babies: 'বেবিদের' };

/** The Bangla name for an English product name ('' when there is nothing to translate) — fully Bangla (see fullBangla). */
export function bnTitle(name: string): string { return fullBangla(bnTitleRaw(name)); }
/** the word-list translation, model numbers / sizes still as written (what bnTitleSmart compares with Google) */
function bnTitleRaw(name: string): string {
  let s = String(name || '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  if (hasBangla(s) && !/[A-Za-z]{3,}/.test(s.replace(/[A-Z0-9-]{2,}/g, ''))) return s; // already Bangla
  s = s.replace(/^\s*product\s+details?\s+of\s+/i, '');
  // a name in two halves joined by " - " / " | ": each half on its own
  const halves = s.split(/\s+[|–—]\s+|\s+-\s+/);
  if (halves.length > 1) return halves.map(bnTitleRaw).filter(Boolean).join(' – ');
  // "10 Pcs" / "Pack of 10" / "Set of 5" → "10 পিস" / "10টির প্যাক" / "5টির সেট"
  s = s.replace(/\b(pack|set|box|pair|lot)\s+of\s+(\d+)\b/gi, (_m, k: string, n: string) => `${n}টির ${WORDS[k.toLowerCase()] || PHRASES[k.toLowerCase()] || k}`);
  const who = s.match(/\s+for\s+(men|man|boys?|gents|women|woman|ladies|girls?|kids?|children|child|bab(?:y|ies))\b/i);
  if (who) return `${FOR_WHO[who[1].toLowerCase()]} ${bnTitleRaw(s.replace(who[0], ''))}`.trim();
  // "A for B" → "B-এর জন্য A";  "A with B" → "B সহ A" (the first one only; the rest stays in order)
  const m = s.match(/^(.+?)\s+(compatible with|without|with|for)\s+(.+)$/i);
  if (m) {
    const [, a, how, b] = m;
    const A = bnTitleRaw(a), B = bnTitleRaw(b);
    const k = how.toLowerCase();
    if (k === 'for' || k === 'compatible with') return `${forOf(B)} ${A}`.trim();
    if (k === 'with') return `${B} সহ ${A}`.trim();
    return `${B} ছাড়া ${A}`.trim();
  }
  return part(s);
}

/** true when the Bangla name says something more than the English one (not just the same letters again) */
export function worthShowing(name: string, bn: string): boolean {
  // a name that is only model numbers / sizes (ESP32, PAM8403 5V) gains nothing from the same letters in Bangla
  const words = String(name || '').split(/[\s,/|()-]+/).filter((w) => /[A-Za-z]{2,}/.test(w) && !isCode(w));
  return !!bn && hasBangla(bn) && words.length > 0 && bn.replace(/\s+/g, '') !== String(name || '').replace(/\s+/g, '');
}

// ---------------------------------------------------------------- words not in the list
// A name with words the list doesn't know ("Ultrasonic Humidifier Mist Maker Fogger"): Google Translate (the same
// free service the shop's English version uses) translates the whole name, then the shop's own words are put back
// where Google picks a bookish one, and the answer is used only if every model number / size came back unchanged.
// Without the internet (or on any doubt) the list's own name stays.
const BOOKISH: [RegExp, string][] = [
  [/অতিস্বনক/g, 'আল্ট্রাসনিক'], [/পরিবর্ধক/g, 'অ্যামপ্লিফায়ার'], [/তক্তা/g, 'বোর্ড'], [/ঝালাই/g, 'সোল্ডারিং'], [/সংবেদক/g, 'সেন্সর'],
  [/প্রতিরোধক/g, 'রেজিস্টর'], [/রোধক/g, 'রেজিস্টর'], [/ধারক/g, 'ক্যাপাসিটর'], [/বৈদ্যুতিক মোটর/g, 'ইলেকট্রিক মোটর'], [/ব্যাটারী/g, 'ব্যাটারি'],
  [/চার্জিং মডিউল/g, 'চার্জিং মডিউল'], [/তারবিহীন/g, 'ওয়্যারলেস'], [/জলরোধী/g, 'ওয়াটারপ্রুফ'], [/বহনযোগ্য/g, 'পোর্টেবল'], [/স্বয়ংক্রিয়/g, 'অটোমেটিক'],
];
/** words the list didn't know (left in English), not counting model numbers / sizes */
export function leftover(bn: string): string[] {
  return (bn.match(/[A-Za-z][A-Za-z'-]{2,}/g) || []).filter((w) => !isCode(w) && !/^[A-Z]{2,}$/.test(w));
}
async function googleEnBn(text: string): Promise<string> {
  const u = 'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=bn&dt=t&q=' + encodeURIComponent(text);
  const r = await fetch(u, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error(`translate ${r.status}`);
  const j = (await r.json()) as unknown[];
  const parts = Array.isArray(j) && Array.isArray(j[0]) ? (j[0] as unknown[]) : [];
  return parts.map((x) => (Array.isArray(x) ? String(x[0] || '') : '')).join('').replace(/\s{2,}/g, ' ').trim();
}
const memoBn = new Map<string, string>();
/** The Bangla name, with Google's help for words not in the list (falls back to bnTitle). */
export async function bnTitleSmart(name: string): Promise<string> {
  const own = bnTitleRaw(name);
  // one unknown word is nearly always a brand (Kemei, Xiaomi): it is written in Bangla letters (fullBangla)
  if (leftover(own).length < 2) return fullBangla(own);
  const key = String(name || '').trim();
  if (memoBn.has(key)) return fullBangla(memoBn.get(key)!);
  try {
    const src = key.replace(/^\s*product\s+details?\s+of\s+/i, '');
    let g = await googleEnBn(src);
    for (const [re, to] of BOOKISH) g = g.replace(re, to);
    if (/\biron\b/i.test(src)) g = g.replace(/লোহা/g, 'আয়রন');
    // every model number / size must come back exactly (DT9205A, 60W, 12V …); and it must really be Bangla
    const codes = (src.match(/[A-Za-z0-9-]*\d[A-Za-z0-9-]*/g) || []).filter((c) => /[A-Za-z]/.test(c) || c.length > 1);
    const ok = g && hasBangla(g) && codes.every((c) => g.includes(c)) && g.length < src.length * 3;
    const out = ok ? g : own;
    if (memoBn.size > 2000) memoBn.clear();
    memoBn.set(key, out);
    return fullBangla(out);
  } catch { return fullBangla(own); }
}

// ---------------------------------------------------------------- fully Bangla (owner, 2026-11-14)
// The Bangla name has no English letters or English digits at all: digits become Bangla (200 → ২০০), sizes are written
// the way people say them (12V → ১২ ভোল্ট, 60W → ৬০ ওয়াট, 200A → ২০০ এ), model numbers / short capitals are read out
// letter by letter (DT9205A → ডিটি৯২০৫এ, USB → ইউএসবি), and any other English word (mostly brand names) is written
// in Bangla letters as it sounds (Kemei → কেমেই).
const BN_DIGIT = '০১২৩৪৫৬৭৮৯';
const bnDigits = (s: string) => s.replace(/[0-9]/g, (d) => BN_DIGIT[Number(d)]);
const LETTER: Record<string, string> = { a: 'এ', b: 'বি', c: 'সি', d: 'ডি', e: 'ই', f: 'এফ', g: 'জি', h: 'এইচ', i: 'আই', j: 'জে', k: 'কে', l: 'এল', m: 'এম',
  n: 'এন', o: 'ও', p: 'পি', q: 'কিউ', r: 'আর', s: 'এস', t: 'টি', u: 'ইউ', v: 'ভি', w: 'ডব্লিউ', x: 'এক্স', y: 'ওয়াই', z: 'জেড' };
const spell = (w: string) => w.toLowerCase().split('').map((c) => LETTER[c] || c).join('');
/** a size right after a number: 12V, 60W, 200A, 2000mAh, 50Hz, 10mm … */
const UNIT: Record<string, string> = { v: 'ভোল্ট', kv: 'কিলোভোল্ট', mv: 'মিলিভোল্ট', vac: 'ভোল্ট এসি', vdc: 'ভোল্ট ডিসি', w: 'ওয়াট', kw: 'কিলোওয়াট', a: 'এ', ma: 'মিলিঅ্যাম্প',
  mah: 'এমএএইচ', ah: 'এএইচ', hz: 'হার্জ', khz: 'কিলোহার্জ', mhz: 'মেগাহার্জ', ghz: 'গিগাহার্জ', mm: 'মিমি', cm: 'সেমি', m: 'মিটার', km: 'কিমি', ft: 'ফুট',
  inch: 'ইঞ্চি', in: 'ইঞ্চি', kg: 'কেজি', g: 'গ্রাম', gm: 'গ্রাম', mg: 'মিলিগ্রাম', l: 'লিটার', ml: 'মিলি', gb: 'জিবি', mb: 'এমবি', tb: 'টিবি', pcs: 'পিস', pc: 'পিস',
  rpm: 'আরপিএম', ohm: 'ওহম', k: 'কে', db: 'ডিবি', p: 'পি', x: 'x', uf: 'মাইক্রোফ্যারাড', nf: 'ন্যানোফ্যারাড', pf: 'পিকোফ্যারাড', awg: 'এডব্লিউজি', f: 'এফ',
  core: 'কোর', pin: 'পিন', pins: 'পিন', ch: 'চ্যানেল', way: 'ওয়ে', gang: 'গ্যাং', layer: 'লেয়ার', gauge: 'গেজ', bit: 'বিট', s: 'এস', th: 'তম', nd: 'য়', rd: 'য়', st: 'ম' };
/** names people in Bangladesh already write in Bangla */
const KNOWN: Record<string, string> = { arduino: 'আরডুইনো', raspberry: 'রাসবেরি', pi: 'পাই', samsung: 'স্যামসাং', sony: 'সনি', walton: 'ওয়ালটন', gree: 'গ্রি', haier: 'হায়ার', midea: 'মিডিয়া', general: 'জেনারেল', rangs: 'র‍্যাংগস', singer: 'সিঙ্গার', xiaomi: 'শাওমি', mi: 'এমআই', kemei: 'কেমেই', philips: 'ফিলিপস', panasonic: 'প্যানাসনিক', hitachi: 'হিটাচি', toshiba: 'তোশিবা', sharp: 'শার্প', vision: 'ভিশন', jamuna: 'যমুনা', minister: 'মিনিস্টার', google: 'গুগল', android: 'অ্যান্ড্রয়েড', bluetooth: 'ব্লুটুথ', wifi: 'ওয়াইফাই', type: 'টাইপ', pro: 'প্রো', max: 'ম্যাক্স', mini: 'মিনি', plus: 'প্লাস', ultra: 'আল্ট্রা', smart: 'স্মার্ট', new: 'নিউ', original: 'অরিজিনাল', remote: 'রিমোট', apple: 'অ্যাপল', iphone: 'আইফোন', oppo: 'অপো', vivo: 'ভিভো', realme: 'রিয়েলমি', huawei: 'হুয়াওয়ে', nokia: 'নোকিয়া', lenovo: 'লেনোভো', dell: 'ডেল', hp: 'এইচপি', asus: 'আসুস', acer: 'এসার', intel: 'ইন্টেল', amd: 'এএমডি', nodemcu: 'নোডএমসিইউ', esp: 'ইএসপি', atmega: 'এটমেগা', stm: 'এসটিএম', uno: 'উনো', nano: 'ন্যানো', mega: 'মেগা', micro: 'মাইক্রো', lora: 'লোরা', chigo: 'চিগো', carrier: 'ক্যারিয়ার', daikin: 'ডাইকিন', fujitsu: 'ফুজিৎসু', hisense: 'হাইসেন্স', tcl: 'টিসিএল', vestel: 'ভেস্টেল', konka: 'কনকা', marcel: 'মার্সেল', transtec: 'ট্রান্সটেক', eco: 'ইকো', inverter: 'ইনভার্টার', dual: 'ডুয়াল', led: 'এলইডি', lcd: 'এলসিডি', oled: 'ওলেড', digital: 'ডিজিটাল', module: 'মডিউল', board: 'বোর্ড', sensor: 'সেন্সর', kit: 'কিট', set: 'সেট', box: 'বক্স', black: 'কালো', white: 'সাদা', red: 'লাল', blue: 'নীল', green: 'সবুজ', yellow: 'হলুদ', silver: 'সিলভার', gold: 'গোল্ড', golden: 'গোল্ডেন', pink: 'গোলাপি', grey: 'ধূসর', gray: 'ধূসর', air: 'এয়ার', conditioner: 'কন্ডিশনার', op: 'অপ', amp: 'অ্যাম্প', band: 'ব্যান্ড', strap: 'স্ট্র্যাপ', voice: 'ভয়েস', rgb: 'আরজিবি', ac: 'এসি', dc: 'ডিসি', tv: 'টিভি', usb: 'ইউএসবি', ic: 'আইসি', pcb: 'পিসিবি', ups: 'ইউপিএস', ir: 'আইআর', rf: 'আরএফ', gps: 'জিপিএস', sd: 'এসডি', solid: 'সলিড', state: 'স্টেট', static: 'স্ট্যাটিক', anti: 'অ্যান্টি', schottky: 'শটকি', quickly: 'কুইকলি', warm: 'ওয়ার্ম', up: 'আপ', segment: 'সেগমেন্ট', relief: 'রিলিফ', plated: 'প্লেটেড', butterfly: 'বাটারফ্লাই', snake: 'স্নেক', anklet: 'এঙ্কলেট', payel: 'পায়েল', speed: 'স্পিড', control: 'কন্ট্রোল', split: 'স্প্লিট', style: 'স্টাইল', electrolytic: 'ইলেক্ট্রোলাইটিক', radial: 'রেডিয়াল', lifepo: 'লাইফেপো', koku: 'কোকু', tatal: 'টাটাল', counter: 'কাউন্টার', rain: 'রেইন', area: 'এরিয়া', weather: 'ওয়েদার', women: 'মেয়েদের', woman: 'মেয়েদের', men: 'ছেলেদের', large: 'বড়', small: 'ছোট', big: 'বড়', long: 'লম্বা', short: 'ছোট', soft: 'সফট', hard: 'হার্ড', jersey: 'জার্সি', hijab: 'হিজাব', maroon: 'মেরুন', brown: 'বাদামি', orange: 'কমলা', purple: 'বেগুনি', lead: 'লিড', wire: 'তার', motherboard: 'মাদারবোর্ড', jumpering: 'জাম্পারিং', jumper: 'জাম্পার', light: 'লাইট', lamp: 'ল্যাম্প', holder: 'হোল্ডার', motion: 'মোশন', infrared: 'ইনফ্রারেড', precision: 'প্রিসিশন', portable: 'পোর্টেবল', rechargeable: 'রিচার্জেবল', wireless: 'ওয়্যারলেস', waterproof: 'ওয়াটারপ্রুফ', magnetic: 'ম্যাগনেটিক', automatic: 'অটোমেটিক', electric: 'ইলেকট্রিক', electronic: 'ইলেকট্রনিক', power: 'পাওয়ার', high: 'হাই', low: 'লো', quality: 'কোয়ালিটি', heavy: 'হেভি', duty: 'ডিউটি', home: 'হোম', kitchen: 'কিচেন', car: 'কার', bike: 'বাইক', baby: 'বেবি', kids: 'বাচ্চাদের', ladies: 'মেয়েদের', gents: 'ছেলেদের', fashion: 'ফ্যাশন', watch: 'ওয়াচ', bag: 'ব্যাগ', shoe: 'জুতা', shoes: 'জুতা', cap: 'ক্যাপ', shirt: 'শার্ট', pant: 'প্যান্ট', bottle: 'বোতল', glass: 'গ্লাস', steel: 'স্টিল', plastic: 'প্লাস্টিক', metal: 'মেটাল', wood: 'কাঠ', wooden: 'কাঠের', leather: 'চামড়া', silicone: 'সিলিকন', rubber: 'রাবার', cotton: 'সুতি', fan: 'ফ্যান', bulb: 'বাল্ব', switch: 'সুইচ', socket: 'সকেট', plug: 'প্লাগ', adapter: 'অ্যাডাপ্টার', charger: 'চার্জার', cable: 'ক্যাবল', battery: 'ব্যাটারি', speaker: 'স্পিকার', headphone: 'হেডফোন', earphone: 'ইয়ারফোন', microphone: 'মাইক্রোফোন', camera: 'ক্যামেরা', display: 'ডিসপ্লে', screen: 'স্ক্রিন', keyboard: 'কিবোর্ড', mouse: 'মাউস', tester: 'টেস্টার', meter: 'মিটার', tool: 'টুল', tools: 'টুলস', machine: 'মেশিন', pump: 'পাম্প', motor: 'মোটর', gear: 'গিয়ার', wheel: 'হুইল', spray: 'স্প্রে', gun: 'গান', pipe: 'পাইপ', water: 'পানি', mist: 'মিস্ট', maker: 'মেকার', fogger: 'ফগার', humidifier: 'হিউমিডিফায়ার', body: 'বডি', with: 'সহ', for: '', and: 'ও', or: 'বা', of: '', the: '', to: 'টু' };
/** any other English word, written in Bangla letters as it sounds (a simple, predictable reading) */
function sounds(word: string): string {
  const w = word.toLowerCase().replace(/(.)\1+/g, '$1').replace(/er$/, '#');
  const C: [string, string][] = [['tion', 'শন'], ['sion', 'শন'], ['sh', 'শ'], ['ch', 'চ'], ['th', 'থ'], ['ph', 'ফ'], ['kh', 'খ'], ['gh', 'ঘ'], ['ck', 'ক'], ['ng', 'ং'],
    ['b', 'ব'], ['c', 'ক'], ['d', 'ড'], ['f', 'ফ'], ['g', 'গ'], ['h', 'হ'], ['j', 'জ'], ['k', 'ক'], ['l', 'ল'], ['m', 'ম'], ['n', 'ন'], ['p', 'প'], ['q', 'ক'],
    ['r', 'র'], ['s', 'স'], ['t', 'ট'], ['v', 'ভ'], ['w', 'ও'], ['x', 'ক্স'], ['z', 'জ']];
  const V: [string, string, string][] = [['ee', 'ই', 'ী'], ['oo', 'উ', 'ু'], ['ea', 'ই', 'ি'], ['ai', 'আই', 'াই'], ['ay', 'এ', 'ে'], ['ou', 'আউ', 'াউ'],
    ['ei', 'এই', 'েই'], ['oi', 'অয়', 'য়'], ['a', 'আ', 'া'], ['e', 'এ', 'ে'], ['i', 'ই', 'ি'], ['o', 'ও', 'ো'], ['u', 'উ', 'ু'], ['y', 'ই', 'ি']];
  let out = '';
  let afterConsonant = false;
  for (let i = 0; i < w.length;) {
    // "c"/"g" before e, i, y: s / j sound
    if ((w[i] === 'c') && /[eiy]/.test(w[i + 1] || '')) { out += 'স'; afterConsonant = true; i++; continue; }
    if (w.startsWith('qu', i)) { out += (afterConsonant ? '্' : '') + 'কু'; afterConsonant = false; i += 2; continue; }
    const v = V.find(([k]) => w.startsWith(k, i));
    if (v && !(v[0] === 'y' && i === 0)) {
      // a final "e" after a consonant is silent (Kite → কাইট is beyond this; "rope" → রোপ)
      if (v[0] === 'e' && i === w.length - 1 && afterConsonant && w.length > 3) { i++; continue; }
      out += afterConsonant ? v[2] : v[1];
      afterConsonant = false;
      i += v[0].length;
      continue;
    }
    const c = C.find(([k]) => w.startsWith(k, i));
    if (c) {
      if (c[0] === 'w' && /[aeiou]/.test(w[i + 1] || '')) { out += 'ওয়'; afterConsonant = true; i++; continue; }
      if (c[0] === 'y' || c[0] === 'r' && i === w.length - 1 && /[eo]r$/.test(w)) { out += 'র'; afterConsonant = true; i++; continue; }
      // two consonants together are joined (st → স্ট, tr → ট্র); "ng" and "tion" stand alone
      if (afterConsonant && !/[ংন]$/.test(out) && !out.endsWith('শন') && c[1] !== 'ং' && c[0] !== 'tion' && c[0] !== 'sion') out += '্';
      out += c[1];
      afterConsonant = c[0] !== 'tion' && c[0] !== 'sion';
      i += c[0].length;
      continue;
    }
    out += w[i] === '#' ? (afterConsonant ? 'ার' : 'আর') : w[i];
    afterConsonant = false;
    i++;
  }
  return out;
}
/** one English run inside the name → Bangla */
function latinRun(run: string, afterNumber: boolean, whole: boolean): string {
  const low = run.toLowerCase();
  if (afterNumber && UNIT[low] !== undefined && whole) return ' ' + UNIT[low];
  if (KNOWN[low] !== undefined) return KNOWN[low];
  if (WORDS[low] && !/[A-Za-z]/.test(WORDS[low])) return WORDS[low];
  // short capitals / codes are read letter by letter: USB, HC, DT, KM, N; a word without vowels too (RGB, PCB)
  if ((run === run.toUpperCase() && run.length <= 3) || run.length <= 2 || !/[aeiouy]/i.test(run)) return spell(run);
  return sounds(run);
}
/** Any text → fully Bangla (no English letters, no English digits). Bangla text passes through unchanged. */
export function fullBangla(text: string): string {
  return String(text || '').replace(/[A-Za-z0-9]+(?:\.[0-9]+[A-Za-z0-9]*)*/g, (tok, at: number, all: string) => {
    const prevChar = all[at - 1] || '';
    const parts = tok.match(/[0-9]+(?:\.[0-9]+)?|[A-Za-z]+/g) || [tok];
    // "200A", "12V", "2000mAh", "10.5mm": a number with a size after it (and nothing else)
    const nextChar = all[at + tok.length] || '';
    // part of a model code ("900M-T-SK", "KD-900M") is read as letters, not as a size
    const inCode = (prevChar === '-' && /[A-Za-z]/.test(all[at - 2] || '')) || (nextChar === '-' && /[A-Za-z]/.test(all[at + tok.length + 1] || ''));
    const numUnit = parts.length === 2 && /^[0-9]/.test(parts[0]) && /^[A-Za-z]+$/.test(parts[1]) && UNIT[parts[1].toLowerCase()] !== undefined && !/[A-Za-z]/.test(prevChar) && !inCode;
    let out = '';
    parts.forEach((p, i) => {
      if (/^[0-9]/.test(p)) out += bnDigits(p);
      else out += latinRun(p, i > 0 && /^[0-9]/.test(parts[i - 1]), numUnit);
    });
    return out;
  }).replace(/\s{2,}/g, ' ').trim();
}
