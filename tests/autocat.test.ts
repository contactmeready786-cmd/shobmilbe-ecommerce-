// 🗂️ Automatic categories: real product names from the shop land in the right sub-category (owner, 2026-11-28).
// The main categories never change; these names were the ones that used to go wrong.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggest, TREE } from '../lib/services/autocat';

const CASES: [string, string][] = [
  ['BC547 General Purpose NPN Transistor TO-92 45V 100mA', 'transistor'],
  ['IRF3205 N-Channel Power MOSFET 55V 110A TO-220', 'transistor'],
  ['FGA25N120 1200V 25A NPT Trench IGBT Transistor', 'transistor'],
  ['1N4007 Rectifier Diode 1A 1000V (DO-41)', 'diode'],
  ['BT136 4A 600V Triac TO-220 for AC Control and Dimmers', 'diode'],
  ['KBPC3510 35A 1000V Single Phase Bridge Rectifier Metal Case', 'diode'],
  ['16 MHz Quartz Crystal Oscillator HC-49 for Arduino', 'crystal-inductor'],
  ['Radial Inductor 470uH Magnetic Core Ferrite Drum', 'crystal-inductor'],
  ['BANGLADESHI 12V 3A Transformer 12-0-12V 3Amp Input AC 220V 50Hz Output', 'crystal-inductor'],
  ['5V Active Buzzer', 'buzzer'],
  ['Arduino UNO R3 Microcontroller Board with USB Cable', 'dev-boards'],
  ['CP2102 USB to TTL UART Converter Module', 'dev-boards'],
  ['DS3231 Precision Real Time Clock RTC Module', 'dev-boards'],
  ['0.96 Inch OLED Display I2C SSD1306', 'display'],
  ['TM1637 4 Digit 7 Segment LED Display Module', 'display'],
  ['830 Tie-Point Solderless Breadboard Full Size Prototyping Board', 'pcb-board'],
  ['Veroboard Strip Board Copper Track PCB Circuit Board', 'pcb-board'],
  ['EGS002 Pure Sine Wave 5V DC- AC Pure Sine Wave Inverter SPWM Driver Board', 'ips-inverter'],
  ['DIY 12V Portable Spot Welding Machine PCB Board with Pen 200A', 'ips-inverter'],
  ['N52 Neodymium Disc Magnet 20x2mm NdFeB Heavy Duty', 'hardware'],
  ['M3 Round Head Screws M3x6mm Stainless Steel', 'hardware'],
  ['2mm Transparent Clear Acrylic Sheet 12x12 Inch', 'hardware'],
  ['Heat Sink Aluminium Radiator For Transistor 17mm', 'hardware'],
  ['F450 Quadcopter Drone Frame Kit with Landing Gear', 'diy-kits'],
  ['USB-A to Type-C Charging and Data Cable 1.1 M', 'mobile-computer'],
  ['Anti-Static ESD Safe Gloves 1-Pair Reusable', 'safety-esd'],
  ['Classic 2 Gang 1 Way Wall Switch- 1 Piece', 'switch-socket'],
  ['Maxline ML-512 Multiplug 5 Port Extension Socket Black Multi Plug', 'switch-socket'],
  ['Laptop Power Cord Cable 3 Pin Plug Black', 'wire-cable'],
  ['2389 Charger Fan Circuit DC 6V KN-2389 Light Fan Charger Circuit', 'appliance-parts'],
  ['Electric Kettle Base Plate Universal', 'appliance-parts'],
  // these used to go to the wrong place
  ['MT3608 DC-DC Step Up Boost Converter Module', 'power-converter'],
  ['LM7805 5V Positive Voltage Regulator IC – TO-220, 1A Output', 'ic'],
  ['A4988 Stepper Motor Driver Module For Arduino', 'speed-controller'],
  ['775 Motor DC 12V 21000RPM Double Bearing', 'dc-motor'],
  ['775 Motor Mounting Base Bracket L-Shape For Saw Cutting And Drilling', 'motor-accessories'],
  ['Drill Chuck Set For D775 Motor 0.6-6.0 mm Bit Supported', 'motor-accessories'],
  ['4″ Inch 12V Cooling Fans 4 Inches DC 12V 90x25mm Heatsink Cooler', 'motor-accessories'],
  ['KD 900M-T-K Type Electric Soldering Iron Replacement Tip', 'iron-tips'],
  ['TIP REFRESHER Tools Soldering Iron Tip Refresher', 'solder-accessories'],
  ['MT87 Digital Clamp Meter Multimeter', 'meters'],
  ['5mm Water Clear LED (Ultra Bright)', 'led-component'],
  ['Bluetooth Headphone Battery 3.7V 30mAh Lithium Polymer', 'battery-charger'],
  ['3.7V 2800mAh Lithium Polymer Rechargeable Lipo Battery With Protection', 'battery-charger'],
  ['Masking Tapes 1″ Inch Width 25mm Length 10 Meter Multi Purpose Masking', 'glue-tape'],
  ['Portable Full Body Massager Rechargeable Massage Gun With 6 Speed Control', 'personal-care'],
  ['Zipper Lock Bag Size 3x4 Inch 75x100mm Clear Plastic', 'packaging'],
  ['SimonK 30A ESC Red for BLDC Motor with XT60', 'speed-controller'],
  ['3W 8Ohm Speaker with 2Pin JST Terminal', 'audio-mic'],
  ['Day Night Sensor Switch Automatic On/Off Photocell LDR', 'smart-switch'],
  ['USBasp USB ISP Programmer for AVR ATmega ATtiny Microcontrollers', 'dev-boards'],
];

test('autocat: product names go to the right sub-category', () => {
  const wrong = CASES.filter(([name, slug]) => suggest(name) !== slug).map(([name, slug]) => `${name} → ${suggest(name)} (want ${slug})`);
  assert.deepEqual(wrong, []);
});

test('autocat: every slug a rule can give is in the tree, and the main categories stay the same', () => {
  const slugs = new Set<string>();
  const walk = (nodes: typeof TREE) => nodes.forEach(([s, , , kids]) => { slugs.add(s); if (kids) walk(kids); });
  walk(TREE);
  for (const [, slug] of CASES) assert.ok(slugs.has(slug), slug);
  assert.deepEqual(TREE.map((n) => n[0]), ['electronics', 'soldering', 'electrical', 'remote', 'fashion', 'packaging', 'digital-products', 'home-appliance']);
});
