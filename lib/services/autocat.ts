// Automatic categories (স্বয়ংক্রিয় ক্যাটাগরি): reads each product's name and puts it in the right
// main category → sub-category (→ sub-sub-category). Remotes are also split by AC / TV / box and by
// company (Walton, Singer, LG …). The tree follows how Bangladeshi electronics & gadget shops
// arrange the same kinds of products.
//
//   preview()                 → what would change (nothing saved)
//   apply({ ids, onlyMatched }) → creates the categories that are needed and moves the products
//   suggest(name)             → category slug for one product name (used by product import)

// ---------------------------------------------------------------- the tree
// [slug, name, icon, children]
import { q, tx } from '../db';
import type { Body } from '../types';
import type { Tx } from '../pg';
import type { CategoriesRow } from '../data/rows';
/** [slug, name, icon, sub-categories?] */
type TreeNode = [string, string, string, TreeNode[]?];
const TREE: TreeNode[] = [
  ['electronics', 'ইলেকট্রনিক্স', '📟', [
    ['circuits', 'সার্কিট ও মডিউল', '🧩', [
      ['audio-amplifier', 'অডিও অ্যামপ্লিফায়ার বোর্ড', '🔊'],
      ['power-converter', 'পাওয়ার ও কনভার্টার মডিউল', '⚡'],
      ['charging-bms', 'ব্যাটারি চার্জিং ও BMS বোর্ড', '🔋'],
      ['mini-ups', 'মিনি UPS ও পাওয়ার ব্যাংক কিট', '🔌'],
      ['speed-controller', 'মোটর স্পিড ও ডিমার কন্ট্রোলার', '🎚️'],
      ['temp-controller', 'টেম্পারেচার কন্ট্রোলার ও ইনকিউবেটর', '🌡️'],
      ['mist-maker', 'মিস্ট মেকার ও হিউমিডিফায়ার মডিউল', '💨'],
      ['wireless-relay', 'ওয়াইফাই, ব্লুটুথ, RF ও রিলে মডিউল', '📡'],
      ['dev-boards', 'আরডুইনো, ডেভেলপমেন্ট বোর্ড ও প্রোগ্রামার', '🤖'],
      ['display', 'ডিসপ্লে মডিউল (LCD, OLED, সেভেন সেগমেন্ট)', '🖥️'],
      ['pcb-board', 'ভেরোবোর্ড, ব্রেডবোর্ড ও পিসিবি', '🟩'],
      ['ips-inverter', 'IPS, ইনভার্টার ও ওয়েল্ডিং বোর্ড', '🔋'],
    ]],
    ['sensors', 'সেন্সর', '📍'],
    ['components', 'কম্পোনেন্ট / পার্টস', '🔋', [
      ['ic', 'আইসি ও আইসি সকেট', '🔲'],
      ['capacitor', 'ক্যাপাসিটর ও ভ্যারিস্টর', '🧪'],
      ['resistor', 'রেজিস্টর ও পোটেনশিওমিটার', '〰️'],
      ['switch-connector', 'সুইচ, কানেক্টর ও জাম্পার তার', '🔘'],
      ['led-component', 'এলইডি (LED)', '💡'],
      ['relay', 'রিলে', '🔁'],
      ['transistor', 'ট্রানজিস্টর, মসফেট ও IGBT', '🔺'],
      ['diode', 'ডায়োড, রেক্টিফায়ার ও ট্রায়াক', '➡️'],
      ['crystal-inductor', 'ক্রিস্টাল, ইন্ডাক্টর ও ট্রান্সফরমার', '🌀'],
      ['buzzer', 'বাজার ও সাইরেন', '📢'],
    ]],
    ['motors-pumps', 'মোটর ও পাম্প', '⚙️', [
      ['dc-motor', 'ডিসি ও গিয়ার মোটর', '⚙️'],
      ['servo-bldc', 'সার্ভো ও BLDC মোটর', '🤖'],
      ['water-pump', 'পানির পাম্প', '💧'],
      ['motor-accessories', 'চাকা, ফ্যান ও মোটর অ্যাক্সেসরিজ', '🛞'],
    ]],
    ['battery-charger', 'ব্যাটারি ও চার্জার', '🔋'],
    ['audio-mic', 'মাইক্রোফোন ও অডিও', '🎤'],
    ['hardware', 'হার্ডওয়্যার ও DIY সামগ্রী', '🔩'],
    ['diy-kits', 'DIY কিট, রোবট ও ড্রোন', '🚁'],
    ['mobile-computer', 'মোবাইল ও কম্পিউটার অ্যাক্সেসরিজ', '📱'],
  ]],
  ['soldering', 'সোল্ডারিং ও টুলস', '🔥', [
    ['soldering-iron', 'সোল্ডারিং আয়রন ও স্টেশন', '🔥'],
    ['iron-tips', 'আয়রন বিট, টিপ ও কয়েল', '📍'],
    ['solder-accessories', 'আয়রন স্ট্যান্ড ও টিপ ক্লিনার', '🧽'],
    ['solder-wire', 'রাং ও সোল্ডারিং তার', '🧵'],
    ['flux-paste', 'ফ্লাক্স ও সোল্ডার পেস্ট', '🧴'],
    ['chemicals', 'কেমিক্যাল, থিনার ও থার্মাল পেস্ট', '🧪'],
    ['glue-tape', 'গ্লু ও টেপ', '🩹'],
    ['meters', 'মাল্টিমিটার, মিটার ও টেস্টার', '📏'],
    ['repair-tools', 'মোবাইল ও পিসিবি রিপেয়ারিং টুলস', '📱'],
    ['hand-tools', 'স্ক্রু ড্রাইভার, প্লায়ার্স ও হ্যান্ড টুলস', '🪛'],
    ['safety-esd', 'সেফটি ও ESD সামগ্রী', '🧤'],
  ]],
  ['electrical', 'ইলেকট্রিক্যাল', '🔌', [
    ['lights', 'এলইডি বাল্ব ও লাইট', '💡'],
    ['smart-switch', 'স্মার্ট সুইচ ও সেন্সর সুইচ', '🎛️'],
    ['cable-accessories', 'ক্যাবল ক্লিপ, টাই ও হিট শ্রিংক', '🧷'],
    ['fan-parts', 'ফ্যান ক্যাপাসিটর ও পার্টস', '🌀'],
    ['fuse', 'ফিউজ ও ফিউজ বেস', '🧯'],
    ['adapter-power', 'অ্যাডাপ্টার ও পাওয়ার সাপ্লাই', '🔌'],
    ['wire-cable', 'তার ও ক্যাবল', '🧶'],
    ['switch-socket', 'সুইচ, সকেট, মাল্টিপ্লাগ ও বক্স', '🔌'],
    ['breaker-protector', 'সার্কিট ব্রেকার ও ভোল্টেজ প্রটেক্টর', '🛡️'],
  ]],
  ['remote', 'রিমোট কন্ট্রোল', '🎛️', [
    ['ac-remote', 'এসি রিমোট', '❄️'],
    ['tv-remote', 'টিভি রিমোট', '📺'],
    ['box-remote', 'সেট-টপ ও অ্যান্ড্রয়েড বক্স রিমোট', '📦'],
  ]],
  ['fashion', 'ফ্যাশন', '👗', [
    ['women', 'মেয়েদের', '👩', [
      ['hijab', 'হিজাব', '🧕'],
      ['inner-cap', 'ইনার ক্যাপ', '🧢'],
      ['jewelry', 'জুয়েলারি (পায়েল, বেলি চেইন)', '💍'],
      ['women-care', 'বিউটি ও কেয়ার', '💄'],
    ]],
    ['men', 'ছেলেদের', '👨', [
      ['trimmer', 'ট্রিমার ও হেয়ার ক্লিপার', '✂️'],
    ]],
  ]],
  ['packaging', 'প্যাকেজিং ম্যাটেরিয়ালস', '📦'],
  ['digital-products', 'ডিজিটাল প্রোডাক্ট', '💾'],
  ['home-appliance', 'হোম অ্যাপ্লায়েন্স', '🏠', [
    ['personal-care', 'পার্সোনাল কেয়ার ও হেলথ', '💆'],
    ['household', 'ঘরের দরকারি জিনিস', '🧽'],
    ['appliance-parts', 'হোম অ্যাপ্লায়েন্স পার্টস', '🛠️'],
  ]],
];

// Remote brands, in the order they are written in shops. A company gets its own sub-category
// when it has at least BRAND_MIN remotes of that kind; the rest go to "অন্যান্য কোম্পানি".
const BRAND_MIN = 3;
const BRANDS: [string, string, RegExp][] = [
  ['walton', 'Walton', /walton|ওয়ালটন/], ['singer', 'Singer', /singer|সিঙ্গার/], ['lg', 'LG', /\blg\b|এলজি/],
  ['samsung', 'Samsung', /samsung|স্যামসাং/], ['gree', 'Gree', /\bgree\b/], ['general', 'General', /general|fujitsu|o general/],
  ['midea', 'Midea', /midea|media ac/], ['haier', 'Haier', /haier/], ['vision', 'Vision', /vision|\bvisio\b/], ['rangs', 'Rangs', /rangs/],
  ['panasonic', 'Panasonic', /panasonic/], ['chigo', 'Chigo', /chigo/], ['daikin', 'Daikin', /daikin|york|ascon/],
  ['eco-plus', 'Eco+', /eco ?\+|eco ?plus|ecoplus/], ['transtec', 'Transtec', /transtec|hamim/], ['whirlpool', 'Whirlpool', /whirlpool/],
  ['sony', 'Sony', /sony|bravia/], ['tcl', 'TCL', /\btcl\b/], ['jamuna', 'Jamuna', /jamuna|যমুনা/], ['sharp', 'Sharp', /sharp/],
  ['hisense', 'Hisense', /hisense/], ['mitsubishi', 'Mitsubishi', /mitsubi+shi/], ['aux', 'AUX', /\baux\b|ykr-/], ['enviro', 'Enviro', /enviro/],
  ['minister', 'Minister', /minister/], ['jvco', 'JVCO', /jvco/], ['vertex', 'Vertex', /vertex/], ['metz', 'Metz', /metz/],
  ['akash', 'Akash', /akash/], ['china', 'চায়না', /\bchin(a|ese)\b/],
];
const UNIVERSAL = /universal|1000 in 1|\d+ brands|master remote/;

// ---------------------------------------------------------------- rules (first match wins)
const R: [string, RegExp, RegExp | null][] = [];
const rule = (slug: string, re: RegExp, not?: RegExp | undefined) => R.push([slug, re, not || null]);
// fashion / home first (their words are clear)
rule('digital-products', /gift ?card|license key|activation key|product key|premium account|\bebook|\be-book|online course|ডিজিটাল/);
rule('packaging', /zip(per)? ?lock bag|zipper (lock )?bag|courier (plastic )?bag|packaging (poly|material)|cellophane|stretch (film|wrap)|packing tape|tape dispenser|carton box|bubble ?wrap|poly bag|mailer (bag|box)|প্যাকেজিং|কার্টন/);
rule('inner-cap', /inner ?cap|ইনার ক্যাপ/);
rule('hijab', /hijab|হিজাব/);
rule('jewelry', /anklet|payel|পায়েল|belly chain|necklace|bracelet|earring|nose ?pin/);
rule('women-care', /(razor|shaver|epilator|hair remov).*(women|lady|ladies|female)|(women|lady|ladies|female).*(razor|shaver|epilator)/);
rule('trimmer', /trimmer|hair clipper|clipper|shaver|beard|kemei|ট্রিমার/, /nail|plier|tool|battery|motor|charger|adapter|cable|capacitor|variable|potentiometer|trimpot/);
// (2026-11-28) The rules below were checked one by one against all ~4300 products in the shop. Order matters.
rule('personal-care', /massager|massage (gun|machine|chair|pillow|device)|body massag/);
rule('safety-esd', /esd (safe )?gloves|anti-?static.*(glove|finger|wrist|strap)|finger cots?|safety (goggles|glasses)|eye protection glasses|respirator|gas mask|dust mask|cleanroom wip|work gloves|safety gloves/);
rule('iron-tips', /^(?=.*(solder|iron|900m|t12|hakko|936))(?=.*(\btips?\b|\bbits?\b|\bcoil\b|heating (core|element)|heater core|iron head))/, /stand|cleaner|refresher|tinner/);
rule('soldering-iron', /soldering iron|soldering station|solder station|hot air|heat gun|desoldering station|rework station|soldering gun/, /stand|cleaner|refresher|holder|\bmat\b/);
rule('solder-accessories', /iron stand|tip (cleaner|refresher|tinner)|brass (wool|sponge)|cleaning sponge|soldering stand|helping hand|third hand|desoldering pump|desoldering vacuum|solder sucker|suction pump|lead\(rang\) holder/);
rule('solder-wire', /solder(ing)? wire|tin lead wire|solder wick|desoldering (braid|wick)|\bwick\b|\brang\b(?! holder)/);
rule('flux-paste', /flux|solder(ing)? paste|tin paste|rosin|solder (ink|mask)|uv (curing|solder)/, /bottle/);
rule('chemicals', /thermal (paste|pad|grease|compound|silicone)|thinner|contact cleaner|cleaner spray|isopropyl|silicone grease|wd-?40|heat ?sink (compound|paste)|environmental cleaner|cleaning liquid/);
rule('appliance-parts', /kettle base|kettle repair|rice cooker .*(cable|cord)|cooker (switch|thermostat|contact)|rice cooker contact|kettle (switch|thermostat)|hair dryer switch|defond/);
rule('fan-parts', /fan capacitor|cbb61|ceiling fan (capacitor|parts|bearing|switch)/);
rule('appliance-parts', /(charger|rechargeable) fan (circuit|board|pcb)|fan circuit|light fan .*circuit|emergency light (circuit|board)/);
rule('battery-charger', /battery (holder|box|case|clip|snap|storage|spacer)|cell holder|mini solar panel/, /connector(?! wire)/);
rule('switch-socket', /travel (socket )?adapter|socket adapter|plug adapter|universal adapter plug|multi socket/, /\d+ ?v\b|cctv|adapter(?!.*travel)|chuck/);
rule('wire-cable', /power cord|mains (power )?cable|ac power cable|power cable \d/, /meter|voltmeter|ammeter|power supply|smps/);
rule('mobile-computer', /dongle|wi-?fi adapter|bluetooth adapter|usb (wifi|bluetooth)|video balun/, /module|board/);
rule('mobile-computer', /^[^a-z]*(\d+(\.\d+)? ?m )?(usb|mini usb|micro usb|type-?c)[^,]{0,25}cable/);
rule('mobile-computer', /writing tablet|lcd (writing|drawing)/);
rule('mobile-computer', /card reader|phone (case|cover)|back cover|charging cable|data cable|usb (data |charging )?cable|\botg\b|lightning cable|writing tablet|lcd (writing|drawing)|computer mouse|wireless mouse|keyboard(?! module)|pen ?drive|usb hub|hdmi cable|type-?c cable|micro usb cable/, /arduino|board|module|breakout|programmer|connector|socket|jack/);
rule('diy-kits', /robot (car |arm )?kit|robot car|smart car (kit|chassis)|car chassis|chassis kit|drone kit|quadcopter (kit|frame|transmitter)|frame kit|\bf450\b|\bf330\b|diy kit|science (project )?kit|toy (kit|car kit)|robot arm|robotic arm|solar (car|toy) kit|educational kit|flysky/, /motor(?! kit)|wheel|propeller|servo|battery|driver|header|connector|\bpin\b/);
rule('motor-accessories', /cooling fan|\bdc fan|cpu fan|exhaust fan|brushless fan|\d+ ?mm (\d+v )?fan|fans? \d+v|blower fan|rotary fan|fan protection net|fan 3 blade/, /handy|rechargeable fan|table fan|ceiling|regulator|capacitor|circuit/);
rule('led-component', /\bled smd chip|smd led|led chip|high power led|\d ?w(att)? (led|cob)|led bead/, /bulb|lamp|torch|driver/);
rule('led-component', /\b\d{1,2} ?mm (\w+ ){0,4}led\b|\bled (\w+ ){0,3}(diode|holder)\b|ice cream led|straw hat|uv (smd )?led|uv money checker led|led mixed|mixed \d+ ?mm|water clear led/, /bulb(?! s?white straw)|lamp|torch|driver|display|matrix|segment/);
rule('speed-controller', /stepper (motor )?driver|a4988|drv8825|motor driver/, /stepper motor with|\bchip\b|\bic\b/);
rule('ips-inverter', /\bips\b.*(board|circuit|mosfet)|inverter (board|circuit)|relay blank oscillation/, /\bbox\b|casing|cover/);
rule('power-converter', /xl40\d\d|lm2596|lm2577|mp1584|mt-?3608|buck|boost|step.?down|step.?up|dc.?dc|breadboard power supply/, /\bic\b|transistor|diode|inductor|\besc\b|e\.s\.c|speed control/);
rule('chemicals', /thermal (insulator|pad)|silicone insulator|mica (sheet|insulator)/);
rule('hardware', /acrylic|plexiglass|neodymium|\bmagnets?\b|\bscrews?\b|\bbolts?\b|\bnuts?\b|hex spacer|standoff|\bspacers?\b|rubber feet|bumper feet|enclosure|project box|junction box \d|ips (box|casing|cover|body)|inverter casing|plastic (case|box) for|aluminium (case|box)|heat ?sink(?!.*(compound|paste))/, /screw ?driver|magnetic core|tool (kit|set|box)|terminal|reed|magnetic (sensor|switch|lock)|hall|lock|fan|led|driver|regulator ic|speaker|microphone|wrench|hex key|allen|socket|jack|connector|pump|motor|battery/);
rule('ic', /optocoupler|photocoupler|phototransistor|gate driver|driver ic|\bir2\d{3}|\btlp\d{3}|\b4n\d\d\b|\btda ?\d{4}|amplifiers? ic/, /module|board|kit|shield|programmer|adapter board|tester|socket adapter|breakout|speed|pump|casing|box/);
rule('ic', /operational amplifier|op-?amps?\b|dual op/, /module|board/);
rule('diode', /bridge rectifier/, /module(?!.*rectifier)|board/);
rule('diode', /\bdiode|rectifier|\btriac\b|\bdiac\b|thyristor|\bscr\b(?!.*(module|regulator|voltage|controller))|\bbt[a-z]?\d{2,3}\b|\b1n4\d{3}|\b1n5\d{3}|\b1n58\d\d|uf400\d|uf540\d|\bfr\d0\d\b|\bmur\d+|\bmbr\d+|kbpc|\bkbu?\d+|\bgbu\d+|\bgbj\d+|2w10|mb[16]0?s|\bdb10\d|ba159|\bdb-?3\b|by229|\brl20\d|\bsr[1-5]\d0\b|byv\d+|bridge rectif|zener|schottky|\bss\d{2}\b|\bm7\b|\bhv\d\b/, /module|board|laser|\bled\b|optocoupler|moc30|tester|motor|generator/);
rule('transistor', /transistor|mosfet|\bigbt\b|\bjfet\b|darlington|\b(irfz?\d+[a-z]*|irfp\d+|irf\d{3,4}[a-z]*|irlz?\d+|2s[abcdk]\d{3,4}|bc\d{3}[a-c]?|tip\d{2,3}c?|mje\d+|s80\d\d|s85\d\d|s90\d\d|ss80\d\d|ss85\d\d|2n\d{4}|2n\d{3}|stp\d+n[fe]?\d+|fqpf?\d+n\d+|\d{2}n(60|65|120)\w*|mpsa\d+|a1015|c1815|c945|d882|b772|13003|13005|13007|13009|mj\d{4,5}|bd\d{3}|ao\d{4}|si\d{4})\b/, /module|board|kit|array|uln|amplifier board|driver board|tester|heatsink|heat sink|diode|rectifier/);
rule('crystal-inductor', /inductor|\bchoke\b/, /module|tester|meter/);
rule('crystal-inductor', /crystal|\bmhz\b(?!.*(module|transmitter|receiver|rf|remote))|oscillator|resonator|inductor|\bchoke\b|ferrite|toroid|transformer|lamination|\bbobbin|\bee\d{2}\b|\bei\d{2}\b|\bcoil\b/, /module|board|ccfl|inverter|oscilloscope|heat|solder|iron|tester|meter|relay|motor|cable/);
rule('buzzer', /buzzer|siren|\bhorn\b(?! switch)|piezo/, /module|board|switch|button|\bic\b|sensor/);
rule('audio-mic', /\bspeakers?\b|loudspeaker|tweeter|woofer/, /module|board|amplifier|circuit|\bic\b|cable|wire|jack|connector|socket/);
rule('display', /\blcd\b|oled|\btft\b|e-?paper|7[ -]?segment|seven segment|dot matrix|led bar graph|display module|touch (screen|display)|nokia 5110|\b1602\b|lcd ?\d{4}|\b2004\b|\b12864\b|max7219|tm1637|p10 led|lcd i2c|i2c (module|adapter) for lcd|led display/, /writing|drawing|meter|tester|thermostat|controller|charger|mppt|clock|scale|sensor|timer|power supply|thermometer|voltmeter|ammeter|amplifier|decoder|player|converter|buck|boost|bms|protection|incubator|w1209|wire|separator|opening|pry|repair|glue|connector|jack|vga|delay|pwm|generator|adapter|uln|darlington|transistor/);
rule('ips-inverter', /welding (machine|board|pcb|kit)|spot weld/);
rule('pcb-board', /veroboard|vero board|perfboard|perf board|strip ?board|dot (matrix )?pcb|copper clad|etching|\bfecl3|ferric chloride|blank pcb|universal pcb|prototype (pcb|board)|breadboard|bread board|pcb board|pcb (lock|snap) (spacer|support)|lock spacer/, /module|kit|power supply|\bic\b|jumper|wire|header|connector|friendly|inductor/);
rule('ips-inverter', /\bips (board|kit|circuit|card|transformer)|inverter (board|kit|circuit|pcb|card)|sine wave (inverter|board)|egs00\d|welding (machine|board|pcb)|spot weld|ccfl|backlight (driver|board|inverter)|tv backlight|12v to 220v/, /\bbox\b|casing|cover|rectifier/);
rule('temp-controller', /thermostat|temperature (and humidity )?control|humidity control|incubator|w1209|xh-w\d+|stc-?\d+|peltier|thermoelectric|tec1-?\d|egg (turner|tray motor)/);
rule('mist-maker', /\bmist|humidifier|fogger|atomiz|ultrasonic (mist|humid)/);
rule('mini-ups', /mini ups|ups (board|kit|module|circuit|pcb)|power ?bank (kit|module|board|pcb|circuit|case|box)|router ups|wifi ups/);
rule('charging-bms', /\bbms\b|protection (board|circuit|module|pcb)|charging (module|board|control|pcb)|charger (board|module|pcb|circuit)|charge control module|fast charge board|tp4056|tc4056|ip2312|\bbattery (indicator|level|capacity) (module|indicator|display)|usb to 3\.7v/);
rule('audio-amplifier', /amplifier|mp3 decoder|decoder (board|module)|tone (board|control)|preamp|pre-amp|treble|bass (board|control)|music level|vu meter|audio (board|circuit|module|amp)|pam8403|pam8610|tpa3\d{3}|tda7\d{3} (board|module)|xh-m\d+|stereo board|bluetooth (audio|receiver) (board|module)|radio (board|module)|fm (board|module)|audio receiver|receiver (board|module)/);
rule('wireless-relay', /gsm|gprs|\bsim8\d\d|\bsim9\d\d|\bgps\b|neo-?\d?m|rfid|\bnfc\b|rc522|pn532|rdm6300|125 ?khz|13\.56|nrf24|lora|sx127|ethernet|enc28j60|w5500|can (bus|module)|mcp2515|esp-?01|esp8266|esp32|nodemcu|wemos|wi-?fi (module|relay|switch module)|bluetooth module|hc-0[56]|jdy-|433 ?mhz|315 ?mhz|rf (module|transmitter|receiver|remote)|relay module|\bir (receiver|transmitter|remote) module|zigbee|rs-?485 (module|converter)|max485 module|ttl to rs|relay (control )?module|channel relay|solid state relay/, /speaker(?! module)|bulb|plug|smart socket|remote control switch|light switch/);
rule('servo-bldc', /servo|brushless|bldc|a2212|outrunner|\bsg90\b|mg9\d\d|mg996/, /driver|tester|pca9685|\besc\b|e\.s\.c|speed controller/);
rule('dev-boards', /arduino|raspberry|stm32|blue ?pill|black ?pill|digispark|rp2040|pico\b|nrf52840|development board|dev board|microcontroller board|core board|minimum system|programmer|usbasp|st-?link|ch34[01]|cp210\d|ft232|pl2303|usb to (ttl|serial|uart)|\bshield\b|expansion board|breakout|\brtc\b|real time clock|ds3231|ds1307|sd card (module|adapter)|tf card module|micro sd module|keypad|joystick|rotary encoder|level (shifter|converter|conversion)|logic level|\badc\b|\bdac\b|ads1115|mcp4725|laser (diode )?module|isolation (board|module)|optocoupler (module|board)|mp3 player module|voice (player |record)|sound (playback|recording) module|dfplayer|wtv020|isd1820|traffic light (module|led)|ina2\d\d|button module|led module for arduino|prototype shield|sensor shield|gpio|multiplexer module|camera module|ov5647|ov7670/, /sensor(?! shield)|temperature|ultrasonic|adapter\b(?! module)|charger|power supply|hdmi|jumper wire|terminal(?! expansion)|shorting|zif/);
rule('smart-switch', /day ?night|photocell|float switch|auto on.?off|water level controller|water pump controller|motion sensor (switch|light)|pir (switch|sensor switch)|proximity (sensor )?switch|timer switch|digital timer|programmable timer|photo ?sensitive (street )?light switch|street light switch/, /module|\bic\b/);
rule('smart-switch', /(switch|socket|holder|plug).*(remote|smart|timer|pir|motion|photocell|day ?night|wi-?fi|touch|sensor|sound|clap)|(remote|smart|timer|pir|motion|photocell|day ?night|wi-?fi|touch|sound|clap).*(switch|socket|plug|holder)|auto (on|off)/, /module(?!.*(switch|socket))|tact|push button|micro switch|limit switch|reed|rocker|toggle|slide|dip|key switch|sensor module|\bic\b/);
rule('sensors', /sensor|metal detector|ultrasonic|hc-sr\d|\bpir\b|\bldr\b|photoresistor|photosensitive|thermocouple|max6675|ds18b20|dht\d\d|lm35|ntc|thermistor|compass|magnetometer|gyro|accelerometer|mpu-?\d{4}|soil moisture|water level|rain (drop|detection)|flame|\bmq-?\d|hall effect|obstacle|load cell|hx711|weigh(ing|t measurement) (sensor|module|circuit)|fingerprint|heart ?rate|pulse (oximeter )?module|color recognition|tcs\d{4}|reed switch|vibration (sensor|switch)|tilt (sensor|switch)|current sensor|acs712|voltage sensor|flow (sensor|meter)/, /smart (switch|socket)|light switch|bulb|lamp|tester|test pen/);
rule('power-converter', /buck|boost|step[ -]?(up|down)|dc-?dc|converter|smps|lm2596|lm2577|xl\d{4}|mt-?3608|mp1584|\bzvs\b|induction heat|balancer|equaliz|decoy|trigger (board|module)|pd (trigger|decoy)|qc (trigger|decoy)|power distribution|\bpdb\b|mppt|solar (charge )?controller|high voltage (generator|module|igniter)|arc (generator|lighter)|voltage (regulator|protection) (module|board)|power (supply )?module|ldo module|ams1117 module|lm317 (module|board)|regulated power supply board|ac-?dc module|hlk-|fast charg/, /\bic\b|power supply(?! (module|board))|adapter|\besc\b|e\.s\.c|speed control/);
rule('speed-controller', /speed control|\bpwm\b|motor (driver|controller)|dimmer|\bscr (module|regulator|voltage)|ac voltage regulator|voltage regulator 2000w|fan (regulator|speed)|l298|l293|drv\d{4}|a4988|tb6\d{3}|uln2003 (module|board|driver)|mosfet (driver|switch|trigger) (module|board)|xy-mos|\besc\b|electronic speed|stepper driver|servo (driver|tester)|pca9685|timer (relay|module|board|delay)|delay (relay|module|timer)|ne555 (module|board|pulse)|signal generator|pulse generator|xy-lpwm|countdown/, /\bchip\b|\bic\b/);
rule('breaker-protector', /circuit breaker|\bmcb\b|\brcbo\b|\brccb\b|\belcb\b|voltage protect|\bavp\b|over ?voltage|under ?voltage|surge protect|voltage guard|fridge guard|\bspd\b/);
rule('fuse', /\bfuses?\b|fuse (base|holder|box)|ptc (fuse|resettable)|polyfuse|thermal fuse|thermal cut/);
rule('led-component', /\b(smd|\d(\.\d)? ?mm|straw ?hat|piranha|bi-?colou?r|rgb|uv|ir) led\b|led (diode|chip|module|bar|ring|matrix(?! display))|cob (led|chip|light source)|ws28\d\d|sk6812|neopixel|\b(5050|2835|3528|5730|3030)\b|super ?bright led|led for (diy|decoration)|high power led|\d+w (led chip|cob)|led bead|power led|infrared led|ir led|laser diode|led light for decoration/, /bulb|220 ?v|torch|flashlight|rechargeable|lamp|tube|panel light|downlight|ac 2\d0|strip light|street light|flood/);
rule('meters', /multimeter|multi meter|meter\b|tester|clamp meter|thermometer|hygrometer|oscilloscope|voltage detector|test pen|testing pen|charger doctor|usb doctor|\blcr\b|capacitance|esr|logic analy|frequency counter|wattmeter|voltmeter|ammeter|tachometer|lux|anemometer|ph (meter|pen)|tds/, /potentiometer|probe tip|tapes?\b|glue|cable/);
rule('lights', /bulb|lamp\b|light\b|lights\b|torch|flashlight|tube ?light|flood ?light|spot ?light|downlight|led strip|rope light|fairy|lantern|headlamp|head lamp|chandelier|led driver|light driver|led panel/, /light dependent|light sensor|traffic light|light switch|light (control|controller) module|ldr|module|day night|backlight|indicator light|meter|tester|switch|socket|plug|jack|button|connector|\bcell\b|battery cell|lithium battery|\bchip\b|diode|smd|\d ?mm (round )?led|bead|mosquito|insect|uv curing|curing uv/);
rule('relay', /relay/, /module|board/);
rule('capacitor', /capacitor|varistor|\bmov\b|\d+ ?(uf|nf|pf|µf)\b|electrolytic|supercapacitor|super capacitor/, /tester|meter|fan capacitor/);
rule('resistor', /resistor|potentiometer|\bpot\b|preset|trimpot|trimmer pot|rheostat/, /sensor/);
rule('ic', /\bic\b|integrated circuit|ic socket|\b74(ls|hc|hct|f)?\d{2,3}[a-z]{0,2}\b|\bcd4\d{3}|\bcd14\d{3}|\bne55[56]|\blm\d{3,4}[a-z]*|\b78[0-9l]\d\d|\b79\d\d|\bla\d{4}|\btda\d+|\btea\d+|\bpic\d+|dspic|\batmega\d*|\battiny\d*|\bat89|\bmax\d{3,4}|\buln\d+|optocoupler|\bpc8\d\d\b|\bpc123\b|\bmoc30|\btl\d{3}|\bsg35\d\d|\bka\d{4}|\buc38\d\d|op-?amp|opamp|comparator|\bjrc?4558|\b4558\b|\b1458\b|eeprom|\b24c\d+|\b93c\d+|shift register|flip.?flop|logic gate|multiplexer|\bams1117\b|\blm317\b|\blm7805|\bl78\d\d|regulator ic|\bvoltage regulator\b(?!.*(module|board|2000w|scr|ac))|\bmelody ic|\bdip-?\d+|\bsop-?\d+|\bstc\d{2}|\btny\d+|\btop\d{3}|\bviper\d+|\bncp\d+|\bir2\d{3}|\begs\d+ chip|\bht\d{4}|\bpt\d{4}|\bcs\d{4}|\bxl\d{4}e?\d? (ic|chip)/, /module|\bboard\b|kit|shield|programmer|adapter board|tester|socket adapter|breakout/);
rule('household', /weight scale|kitchen scale|digital scale|magic sponge|melamine|spray gun|spray machine|car wash|water spray|mosquito|insect killer|padlock|water heater|electric kettle|display stand|screen clean|handy fan|rechargeable fan|table fan|mini fan(?! module)|room heater|cloth|kitchen|cleaning (kit|brush|cloth)|lunch box|bottle(?! dispenser)|mug|umbrella|wall clock|alarm clock|egg beater|blender|juicer|iron for clothes|steam iron|pipe with gun/, /battery|\bcell\b|pump(?!.*(gun|pipe))|soldering|pcb|module|motor(?!.*(spray|wash))|tape|mobile|motherboard|solder|circuit/);
rule('personal-care', /massager|nebulizer|blood pressure|oximeter(?! (module|sensor))|thermometer gun|body (scale|fat)|shaver|epilator|hair dryer|straightener|curler|\btooth ?brush/, /module|sensor|switch|motor|brush nozzle|wire brush|repairing|display/);
rule('water-pump', /pump|hose clip|soft pipe|ball valve|spray pump nozzle/, /desolder|suction|sucker|solder|spray (gun|machine)|switch|pipe with gun/);
rule('motor-accessories', /motor (mount|mounting|bracket|holder|clamp|seat|stand|base)|pulley|propeller|\b(9450|1045|8045|5045)\b|wheel|coupling|drill chuck|\bchuck\b|fans? (blade|for (\d+ )?motor)|motor fans?|gt2/, /rpm(?!.*chuck)|ball bearing dc/);
rule('dc-motor', /motor/, /driver|controller|regulator|tester|capacitor|mount|bracket|seat|stand|base|spray/);
rule('motor-accessories', /wheel|propeller|\btyres?\b|\btires?\b|pulley|timing belt|\bbelt\b|\bgt2\b|coupling|coupler|bearing|\bgears?\b(?! motor)|cooling fan|dc fan|cpu fan|exhaust fan|brushless fan|\d+mm fan|blower|solenoid|door lock|electric lock|drill chuck|motor (mount|bracket|holder|clamp)|caster|shaft/, /handy|rechargeable fan|table fan|ceiling|regulator|capacitor/);
rule('repair-tools', /opening tool|pry tool|\bspudger|lcd separator|repair (tool|mat|kit|set)|magnif|microscope|loupe|pcb holder|pcb clamp|pcb vise|dispenser bottle|liquid dispenser|alcohol liquid|antistatic brush|esd brush|\bbrush\b|stencil|reballing|bga|preheater|silicone (repair )?mat|screen (separator|remover)|suction cup|oca|uv lamp|uv light|press bottle|blade for pcb|crowbar|mobile stand holder|pcb ruler|cutting mat/, /screw ?driver|wire brush|drill bit/);
rule('hand-tools', /screw ?driver|plier|cutter|tweezer|knife|\bblades?\b|stripper|nipper|wrench|spanner|hammer|\bsaw\b|hacksaw|drill(?! chuck)|grinder|grinding|rotary tool|file set|\bfiles?\b|hex key|allen key|tool (kit|set|box|bag)|crimp(ing)? tool|crimper|wire gauge|measuring tape|tape measure|caliper|\bvise\b|\bvice\b|clamp(?! meter)|chisel|scissor|riveter|spirit level|punch\b|wire brush/, /plier.*(holder|stand)|pcb vise|opening|pry|lcd|phone(?! repair tweezer)|battery|glue|switch|repair kit$/);
rule('glue-tape', /glue|\btapes?\b|adhesive|kapton|\bb-?7000|\bt-?\d000|\be-?8000|epoxy|hot melt stick|super glue|sealant|silicone sealant/, /dispenser/);
rule('cable-accessories', /cable (clip|tie)|zip tie|heat ?shrink|sleev|ferrule|wire terminal|quick disconnect|crimp terminal|spade terminal|ring terminal|fork terminal|\blugs?\b|cable marker|wire connector|cable gland|spiral wrap|insulation tape|electrical tape|wire nut|terminal connector|butt connector|scotchlok/, /block|pcb|header|banana/);
rule('switch-socket', /gang box|junction (pvc )?box|switch box|back box|mk box|batten holder|lamp holder|bulb holder|switch ?board|socket outlet|multi ?plug|extension (board|socket|cord)|power strip|wall socket|wall switch|\b(\d gang|one gang|two gang)\b|ceiling rose|\bholder\b.*(e27|b22|bulb)|(e27|b22) (holder|socket|adapter)/, /module|pcb|smart|remote|timer|touch|wifi|sensor/);
rule('wire-cable', /\bcables?\b|\bwires?\b|\bcords?\b|copper conductor|flat cable|ribbon cable|silicone wire|enamel(ed)? (copper )?wire|super enamel|\bawg\b|\d+ gauge thin/, /jumper|dupont|connector|tie|clip|stripper|tool|wire gauge|gauge tool|terminal|alligator|test lead|probe|solder|kettle|cooker|lug|wire nut|module|board|usb|hdmi|charging|data|otg|lightning|female|male|\bpin\b|holder|power supply|smps/);
rule('adapter-power', /adapter|power supply|charger|smps 12v|\d+v \d+(\.\d+)?a (adapter|power)/, /module|board|breakout|plug adapter|socket adapter|travel adapter|\bpcb|battery charger|bms|lithium charger module|card|battery|lithium|18650|audio|bluetooth|aux/);
rule('battery-charger', /battery|batteries|18650|21700|26650|lipo|li-?po|li-?ion|lithium (cell|battery)|ni-?mh|ni-?cd|\bcells?\b|button cell|cr20\d\d|lr44|\baa\b|\baaa\b|9v battery|battery charger|lithium charger/, /module|board|bms|tester|indicator|monitor|holder|box|case|connector|clip|power ?bank/);
rule('switch-connector', /switch|connector|\bjack\b|\bsocket\b|header|jumper|dupont|terminal block|screw terminal|\bplug\b|push button|tact|alligator|banana|crocodile|test lead|\bprobe\b|\bxt\d0\b|\bjst\b|\bdc (jack|socket)|usb (port|socket|female|male)|battery (holder|box|case|clip|snap|connector)|crimp housing|\bfpc\b|\bffc\b|idc|\bdb\d\b|rj45|\bsma\b|bnc|flexible cable|breakout module/, /multimeter/);
rule('audio-mic', /microphone|\bmic\b|audio|earphone|headphone|earbuds|headset|bluetooth speaker|portable speaker|sound box|speakers?\b|loudspeaker|tweeter|woofer|subwoofer/);
// last chance: an un-named board/module/circuit
rule('circuits', /module|board|circuit|সার্কিট/, /bulb|light|\bled\b|lamp/);

function norm(name: unknown) {
  return String(name || '').toLowerCase().replace(/[০-৯]/g, (d) => String('০১২৩৪৫৬৭৮৯'.indexOf(d))).replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
}

// Remote? → { kind: 'ac-remote'|'tv-remote'|'box-remote', brand: slug|'universal'|null }
type Remote = { kind: string; brand: string | null };
function remoteOf(n: string): Remote | null {
  if (!/remote|রিমোট/.test(n)) return null;
  if (/(switch|lamp holder|remote control device|timer switch)/.test(n) || /\bic\b|decoder|expander|receiver module/.test(n)) return null;
  let kind;
  if (/set ?(up|top)? ?box|akash|\bdth\b|mxq|\btx ?\d|t-x ?\d|t9\d|x96|tv ?box|android box/.test(n)) kind = 'box-remote';
  else if (/\bac\b|a\/c|air ?-?condition|aircon|split|window type|inverter ac|\bac-\d|\barc\d/.test(n)) kind = 'ac-remote';
  else if (!/\btv\b|television|\bled\b|\blcd\b|android|smart|voice|magic|4k/.test(n) && /daikin|york|gree|chigo|midea|eco ?(\+|plus)|whirlpool|\baux\b|enviro|mitsubi/.test(n)) kind = 'ac-remote';
  else kind = 'tv-remote';
  // the company written first in the name
  let brand = null;
  let at = Infinity;
  for (const [slug, , re] of BRANDS) {
    const m = n.match(re);
    if (m && m.index! < at) { at = m.index!; brand = slug; }
  }
  if (!brand && UNIVERSAL.test(n)) brand = 'universal';
  return { kind, brand };
}

// slug for one product name (remotes: the type; the brand is handled when applying)
function classify(name: unknown): { slug: string; remote?: Remote } | null {
  const n = norm(name);
  const r = remoteOf(n);
  if (r) return { slug: r.kind, remote: r };
  for (const [slug, re, not] of R) {
    if (re.test(n) && !(not && not.test(n))) return { slug };
  }
  return null;
}
function suggest(name: unknown) { const c = classify(name); return c ? c.slug : null; }

// ---------------------------------------------------------------- saving
/** one category of the tree, with where it hangs */
type FlatNode = { slug: string; name: string | undefined; icon: string; parent: string | null; sort: number };
function flatTree() {
  const out: FlatNode[] = [];
  const walk = (nodes: TreeNode[], parent: string | null) => nodes.forEach(([slug, name, icon, kids], i) => {
    out.push({ slug, name, icon, parent, sort: i });
    if (kids) walk(kids, slug);
  });
  walk(TREE, null);
  return out;
}
const SEED_NAMES: Record<string, string> = { electronics: 'ইলেকট্রনিক্স', circuits: 'সার্কিট', components: 'কম্পোনেন্ট', soldering: 'সোল্ডারিং', electrical: 'ইলেকট্রিক্যাল', fashion: 'ফ্যাশন' };

// Create (or put in place) the categories with these slugs, parents first. Returns slug → id.
async function ensureCategories(t: Tx, wanted: { slugs: string[]; extra: Map<string, FlatNode> }) {
  const all = flatTree();
  const need = new Set<string>();
  const add = (slug: string) => {
    const node = all.find((x) => x.slug === slug) || wanted.extra.get(slug);
    if (!node || need.has(slug)) return;
    if (node.parent) add(node.parent);
    need.add(slug);
  };
  wanted.slugs.forEach(add);
  const ids = new Map<string, number>();
  for (const slug of need) {
    const node = all.find((x) => x.slug === slug) || wanted.extra.get(slug);
    const parentId = node!.parent ? ids.get(node!.parent) : null;
    const cur = (await t.query<Pick<CategoriesRow, 'id' | 'name'>>('SELECT id, name FROM categories WHERE slug=$1', [slug])).rows[0];
    if (cur) {
      // the shop's first six categories get their new place (and a clearer name if never renamed)
      const rename = SEED_NAMES[slug] && cur.name === SEED_NAMES[slug] && SEED_NAMES[slug] !== node!.name;
      await t.query(`UPDATE categories SET parent_id=$1${rename ? ', name=$3' : ''} WHERE id=$2`, rename ? [parentId, cur.id, node!.name] : [parentId, cur.id]);
      if (SEED_NAMES[slug] && !node!.parent) await t.query('UPDATE categories SET sort=$1 WHERE id=$2', [node!.sort || 0, cur.id]);
      ids.set(slug, cur.id);
    } else {
      const r = (await t.query<Pick<CategoriesRow, 'id'>>('INSERT INTO categories(name, slug, icon, sort, active, parent_id) VALUES($1,$2,$3,$4,true,$5) RETURNING id',
        [node!.name, slug, node!.icon || '📦', node!.sort || 0, parentId])).rows[0];
      ids.set(slug, r.id);
    }
  }
  return ids;
}

// What every product would get. Remote brands get a sub-category only when there are enough of them.
type PlanOpts = {
  ids?: number[] | null;
};
async function plan({ ids = null }: PlanOpts = {}) {
  const products = await q<{ id: number; name: string; category_id: number | null; category_slug: string | null; category_name: string | null }>(`SELECT p.id, p.name, p.category_id, c.slug AS category_slug, c.name AS category_name
    FROM products p LEFT JOIN categories c ON c.id=p.category_id WHERE p.parent_id IS NULL ${ids ? 'AND p.id = ANY($1::int[])' : ''} ORDER BY p.id`, ids ? [ids] : []);
  const rows: ((typeof products)[number] & { c: ReturnType<typeof classify>; to?: string; path?: string })[] = products.map((p) => ({ ...p, c: classify(p.name) }));
  // brand counts per remote kind (whole shop, so small brands still group well later)
  const allRemotes = (await q<{ name: string }>('SELECT name FROM products')).map((p) => remoteOf(norm(p.name))).filter((x): x is NonNullable<typeof x> => !!x);
  const count = new Map<string, number>();
  for (const r of allRemotes) if (r.brand) count.set(r.kind + '|' + r.brand, (count.get(r.kind + '|' + r.brand) || 0) + 1);
  const all = flatTree();
  const extra = new Map<string, FlatNode>();
  for (const r of rows) {
    if (!r.c) continue;
    let slug = r.c.slug;
    if (r.c.remote) {
      const { kind, brand } = r.c.remote;
      const big = brand && (brand === 'universal' || (count.get(kind + '|' + brand) || 0) >= BRAND_MIN);
      const bslug = big ? brand : 'other';
      const bname = brand === 'universal' ? 'ইউনিভার্সাল রিমোট' : big ? (BRANDS.find((b) => b[0] === brand) || [])[1] : 'অন্যান্য কোম্পানি';
      slug = `${kind}-${bslug}`;
      if (!extra.has(slug)) extra.set(slug, { slug, name: bname, icon: kind === 'ac-remote' ? '❄️' : kind === 'tv-remote' ? '📺' : '📦', parent: kind, sort: bslug === 'other' ? 99 : bslug === 'universal' ? 98 : 0 });
    }
    r.to = slug;
    const node = all.find((x) => x.slug === slug) || extra.get(slug);
    const path: (string | undefined)[] = [];
    for (let x = node; x; x = all.find((y) => y.slug === x!.parent) || (x.parent === null ? undefined : extra.get(x.parent))) path.unshift(x.name);
    r.path = path.join(' › ');
  }
  // brand sub-categories sorted by size
  const sizes = new Map<string, number>();
  rows.forEach((r) => { if (r.to && extra.has(r.to)) sizes.set(r.to, (sizes.get(r.to) || 0) + 1); });
  for (const [slug, node] of extra) if (node.sort === 0) node.sort = 50 - Math.min(49, sizes.get(slug) || 0);
  return { rows, extra };
}

async function preview() {
  const { rows } = await plan();
  return rows.map((r) => ({ id: r.id, name: r.name, from: r.category_name || '', to: r.to || null, path: r.path || '', same: !!r.to && r.to === r.category_slug }));
}

// Move products. ids: only these products (null = all). onlyMatched: leave unknown products where they are.
type ApplyOpts = {
  ids?: number[] | null;
};
async function apply({ ids = null }: ApplyOpts = {}) {
  const { rows, extra } = await plan({ ids });
  const todo = rows.filter((r) => r.to);
  if (!todo.length) return { moved: 0, unknown: rows.length };
  return tx(async (t) => {
    const map = await ensureCategories(t, { slugs: [...new Set(todo.map((r) => r.to!))], extra });
    let moved = 0;
    for (const r of todo) {
      const cid = map.get(r.to!);
      if (cid && cid !== r.category_id) { await t.query('UPDATE products SET category_id=$1, updated_at=now() WHERE id=$2', [cid, r.id]); moved++; }
    }
    // variants always sit in their main product's category
    await t.query('UPDATE products v SET category_id=p.category_id FROM products p WHERE v.parent_id=p.id AND v.category_id IS DISTINCT FROM p.category_id');
    // the old top-level "সার্কিট"/"কম্পোনেন্ট" etc. now live inside their main category even if no product moved there
    await ensureCategories(t, { slugs: ['circuits', 'components', 'soldering', 'electrical', 'fashion'].filter((s) => s), extra: new Map() });
    return { moved, unknown: rows.length - todo.length };
  });
}

export { TREE, classify, suggest, preview, apply, remoteOf, norm };
