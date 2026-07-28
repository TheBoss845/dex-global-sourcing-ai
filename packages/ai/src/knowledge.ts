/**
 * DEX procurement domain knowledge.
 *
 * This module is the "training" layer for every AI call in the pipeline:
 * category detection, manufacturer identity resolution, catalog-shorthand
 * expansion, price plausibility bands, and counterfeit/risk heuristics.
 * It is used both deterministically (alias matching, shorthand expansion)
 * and to compose domain-aware system prompts.
 */

/* ------------------------------------------------------------------ */
/* Manufacturer identity resolution                                    */
/* ------------------------------------------------------------------ */

/**
 * Canonical manufacturer names and the aliases/abbreviations vendors use.
 * Keys and values are compared after uppercasing and stripping non-alphanumerics.
 */
export const MANUFACTURER_ALIASES: Record<string, string[]> = {
  TEXASINSTRUMENTS: ['TI', 'TEXASINSTRUMENT', 'BURRBROWN', 'NATIONALSEMICONDUCTOR', 'NATIONALSEMI'],
  STMICROELECTRONICS: ['ST', 'STMICRO', 'SGSTHOMSON'],
  ANALOGDEVICES: ['ADI', 'ANALOG', 'LINEARTECHNOLOGY', 'LINEARTECH', 'LTC', 'MAXIMINTEGRATED', 'MAXIM'],
  NXPSEMICONDUCTORS: ['NXP', 'FREESCALE', 'PHILIPSSEMICONDUCTOR'],
  INFINEON: ['INFINEONTECHNOLOGIES', 'CYPRESS', 'CYPRESSSEMICONDUCTOR', 'INTERNATIONALRECTIFIER', 'IR'],
  ONSEMICONDUCTOR: ['ONSEMI', 'FAIRCHILD', 'FAIRCHILDSEMICONDUCTOR'],
  MICROCHIP: ['MICROCHIPTECHNOLOGY', 'ATMEL', 'MICROSEMI'],
  RENESAS: ['RENESASELECTRONICS', 'INTERSIL', 'IDT', 'DIALOG', 'DIALOGSEMICONDUCTOR'],
  BROADCOM: ['AVAGO', 'AVAGOTECHNOLOGIES', 'LSI'],
  VISHAY: ['VISHAYDALE', 'VISHAYSILICONIX', 'DALE', 'SILICONIX', 'SPRAGUE', 'ROEDERSTEIN'],
  YAGEO: ['PHYCOMP', 'KEMET', 'PULSEELECTRONICS'],
  TDK: ['TDKEPCOS', 'EPCOS', 'TDKLAMBDA', 'LAMBDA'],
  MURATA: ['MURATAMANUFACTURING', 'MURATAPOWERSOLUTIONS'],
  SAMSUNGELECTROMECHANICS: ['SEMCO', 'SAMSUNGEM'],
  TECONNECTIVITY: ['TE', 'TYCO', 'TYCOELECTRONICS', 'AMP', 'RAYCHEM', 'CROMPTONINSTRUMENTS', 'CROMPTON'],
  MOLEX: ['MOLEXCONNECTOR', 'MOLEXLLC'],
  AMPHENOL: ['AMPHENOLICC', 'AMPHENOLRF', 'FCI', 'CONEC'],
  PHOENIXCONTACT: ['PHOENIX'],
  WAGO: ['WAGOKONTAKTTECHNIK'],
  HIROSE: ['HIROSEELECTRIC', 'HRS'],
  JST: ['JAPANSOLDERLESSTERMINAL'],
  ABB: ['ASEABROWNBOVERI', 'ABBGROUP', 'BALDOR', 'THOMASANDBETTS'],
  SIEMENS: ['SIEMENSAG', 'SIEMENSINDUSTRY'],
  SCHNEIDERELECTRIC: ['SCHNEIDER', 'SQUARED', 'TELEMECANIQUE', 'MERLINGERIN', 'APC'],
  EATON: ['EATONCORPORATION', 'CUTLERHAMMER', 'MOELLER', 'BUSSMANN'],
  ROCKWELLAUTOMATION: ['ROCKWELL', 'ALLENBRADLEY', 'AB'],
  MITSUBISHIELECTRIC: ['MITSUBISHI', 'MELCO'],
  OMRON: ['OMRONAUTOMATION', 'OMRONELECTRONICS'],
  DANFOSS: ['DANFOSSDRIVES', 'VACON'],
  YASKAWA: ['YASKAWAELECTRIC', 'YASKAWAAMERICA'],
  GENERALELECTRIC: ['GE', 'GEENERGY', 'GERENEWABLE', 'GERENEWABLEENERGY', 'GEGRID'],
  VESTAS: ['VESTASWINDSYSTEMS'],
  BONFIGLIOLI: ['BONFIGLIOLIVECTRON', 'VECTRON'],
  NORDEX: ['NORDEXSE', 'ACCIONA', 'ACCIONAWINDPOWER'],
  SIEMENSGAMESA: ['GAMESA', 'SGRE'],
  HEWLETTPACKARD: ['HP', 'HPE', 'COMPAQ', 'COMPAQHEWLETTPACKARD', 'HEWLETTPACKARDENTERPRISE', 'HPINC'],
  DELL: ['DELLEMC', 'DELLTECHNOLOGIES', 'EMC', 'ALIENWARE'],
  LENOVO: ['IBM', 'THINKPAD', 'THINKSYSTEM'],
  CISCO: ['CISCOSYSTEMS', 'LINKSYS', 'MERAKI'],
  INTEL: ['INTELCORPORATION', 'ALTERA'],
  AMD: ['ADVANCEDMICRODEVICES', 'XILINX'],
  NVIDIA: ['NVIDIACORPORATION', 'MELLANOX'],
  SEAGATE: ['SEAGATETECHNOLOGY', 'MAXTOR', 'LACIE'],
  WESTERNDIGITAL: ['WD', 'WDC', 'SANDISK', 'HGST', 'HITACHIGST'],
  SAMSUNG: ['SAMSUNGELECTRONICS', 'SAMSUNGSEMICONDUCTOR'],
  MICRON: ['MICRONTECHNOLOGY', 'CRUCIAL'],
  KIOXIA: ['TOSHIBAMEMORY', 'TOSHIBA'],
  FUJITSU: ['FUJITSULIMITED', 'FUJITSUSIEMENS'],
  SUPERMICRO: ['SUPERMICROCOMPUTER', 'SMC'],
  RASPBERRYPI: ['RASPBERRYPIFOUNDATION', 'RASPBERRYPILTD', 'RPI'],
  SIEMENSHEALTHINEERS: ['SIEMENSHEALTHCARE', 'SIEMENSMEDICAL'],
  GEHEALTHCARE: ['GEMEDICAL', 'GEMEDICALSYSTEMS'],
  PHILIPSHEALTHCARE: ['PHILIPS', 'PHILIPSMEDICAL', 'PHILIPSMEDICALSYSTEMS'],
  MEDTRONIC: ['COVIDIEN'],
  DRAGER: ['DRAEGER', 'DRAGERWERK'],
  DATAEXCHANGECORP: ['DEX', 'DATAEXCHANGE', 'DATAEXCHANGECORPORATION'],
  AIRPAX: ['AIRPAXCORPORATION', 'SENSATA', 'SENSATATECHNOLOGIES'],
  CORNELLDUBILIER: ['CDE', 'CORNELLDUBLIER', 'CDECORNELL'],
  PANASONIC: ['MATSUSHITA', 'PANASONICINDUSTRY', 'SANYO'],
  NICHICON: ['NICHICONCORPORATION'],
  RUBYCON: ['RUBYCONCORPORATION'],
  LEM: ['LEMINTERNATIONAL', 'LEMUSA'],
  HONEYWELL: ['HONEYWELLINTERNATIONAL', 'MICROSWITCH'],
  LITTELFUSE: ['LITTLEFUSE', 'IXYS'],
  BOURNS: ['BOURNSINC'],
  SICK: ['SICKAG', 'SICKSENSORS'],
  PEPPERLFUCHS: ['PEPPERLANDFUCHS', 'PF'],
  BALLUFF: ['BALLUFFGMBH'],
  IFM: ['IFMELECTRONIC', 'IFMEFECTOR'],
  FESTO: ['FESTOAG', 'FESTOCORP'],
  SMC: ['SMCCORPORATION', 'SMCPNEUMATICS'],
  PARKER: ['PARKERHANNIFIN'],
  BOSCHREXROTH: ['REXROTH', 'BOSCH'],
  SKF: ['SKFGROUP', 'SKFBEARINGS'],
  TIMKEN: ['TIMKENCOMPANY'],
  NSK: ['NSKBEARINGS', 'NSKLTD'],
};

function normalizeName(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

const ALIAS_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [canonical, aliases] of Object.entries(MANUFACTURER_ALIASES)) {
    map.set(canonical, canonical);
    for (const alias of aliases) map.set(normalizeName(alias), canonical);
  }
  return map;
})();

/** Resolve any manufacturer spelling/abbreviation to a canonical identity. */
export function canonicalManufacturer(raw: string): string {
  const normalized = normalizeName(raw);
  return ALIAS_LOOKUP.get(normalized) ?? normalized;
}

/** True when two manufacturer strings plausibly refer to the same company. */
export function sameManufacturer(a: string, b: string): boolean {
  const left = canonicalManufacturer(a);
  const right = canonicalManufacturer(b);
  if (!left || !right) return true;
  return left === right || left.includes(right) || right.includes(left);
}

/* ------------------------------------------------------------------ */
/* Catalog shorthand                                                   */
/* ------------------------------------------------------------------ */

/** Cryptic catalog abbreviations → readable English. */
export const CATALOG_SHORTHAND: Record<string, string> = {
  ASSY: 'assembly',
  ASM: 'assembly',
  BZL: 'bezel',
  FRT: 'front',
  RR: 'rear',
  BTM: 'bottom',
  TP: 'top',
  PWA: 'printed wiring assembly',
  PWB: 'printed wiring board',
  PCB: 'printed circuit board',
  PCBA: 'printed circuit board assembly',
  PLN: 'planar / motherboard',
  MB: 'motherboard',
  CONN: 'connector',
  RCPT: 'receptacle',
  HSG: 'housing',
  BRKT: 'bracket',
  MNT: 'mount',
  PSU: 'power supply unit',
  PS: 'power supply',
  HTSNK: 'heatsink',
  HS: 'heatsink',
  FN: 'fan',
  CBL: 'cable',
  HDD: 'hard disk drive',
  SSD: 'solid state drive',
  MEM: 'memory',
  DIMM: 'memory module',
  PROC: 'processor',
  CPU: 'processor',
  KYBD: 'keyboard',
  KB: 'keyboard',
  LCD: 'display panel',
  DSPL: 'display',
  BAT: 'battery',
  BATT: 'battery',
  CHGR: 'charger',
  ADPT: 'adapter',
  CB: 'circuit breaker',
  XFMR: 'transformer',
  XFRMR: 'transformer',
  CAP: 'capacitor',
  RES: 'resistor',
  IND: 'inductor',
  SW: 'switch',
  PB: 'push button',
  RLY: 'relay',
  CONT: 'contactor',
  TERM: 'terminal',
  TB: 'terminal block',
  ENCL: 'enclosure',
  GSKT: 'gasket',
  ORING: 'o-ring',
  BRG: 'bearing',
  SHFT: 'shaft',
  CPLG: 'coupling',
  VLV: 'valve',
  SOL: 'solenoid',
  HYD: 'hydraulic',
  PNEU: 'pneumatic',
  MTR: 'motor',
  GRBX: 'gearbox',
  INV: 'inverter',
  VFD: 'variable frequency drive',
  IGBT: 'insulated-gate bipolar transistor module',
  SCR: 'silicon controlled rectifier',
  RECT: 'rectifier',
  FLTR: 'filter',
  SNSR: 'sensor',
  XDCR: 'transducer',
  ENC: 'encoder',
  W: 'with',
  WO: 'without',
  QTY: 'quantity',
  NOS: 'new old stock',
  REF: 'refurbished',
  REFURB: 'refurbished',
  OEM: 'original equipment manufacturer',
};

/** Expand catalog shorthand tokens inside a description (non-destructive). */
export function expandShorthand(description: string): string {
  return description
    .split(/([,\s/]+)/)
    .map((token) => {
      const key = token.toUpperCase().replace(/[^A-Z]/g, '');
      const expansion = CATALOG_SHORTHAND[key];
      return expansion && token.length <= 6 ? expansion : token;
    })
    .join('');
}

/* ------------------------------------------------------------------ */
/* Part categories with price plausibility bands                       */
/* ------------------------------------------------------------------ */

export type PartCategory = {
  id: string;
  label: string;
  keywords: string[];
  typicalUsd: [number, number];
  notes: string;
};

export const PART_CATEGORIES: PartCategory[] = [
  {
    id: 'passive',
    label: 'Passive component (resistor/capacitor/inductor)',
    keywords: ['resistor', 'capacitor', 'inductor', 'ferrite', 'varistor', 'thermistor', 'uf', 'ohm', 'farad'],
    typicalUsd: [0.01, 50],
    notes: 'Unit prices are usually cents; reel/box listings can be tens of dollars. A $500 "capacitor" is usually a kit, reel, or scam.',
  },
  {
    id: 'semiconductor',
    label: 'Semiconductor (IC, transistor, regulator, module)',
    keywords: ['regulator', 'transistor', 'mosfet', 'diode', 'ic', 'microcontroller', 'amplifier', 'converter', 'igbt', 'rectifier', 'thyristor'],
    typicalUsd: [0.1, 2000],
    notes: 'Commodity ICs are under $20; power modules (IGBT) legitimately reach hundreds to low thousands. Obsolete parts carry broker premiums.',
  },
  {
    id: 'connector',
    label: 'Connector / cable / interconnect',
    keywords: ['connector', 'd-sub', 'backshell', 'receptacle', 'plug', 'socket', 'header', 'cable', 'conduit', 'harness'],
    typicalUsd: [0.2, 300],
    notes: 'Most connectors are $0.20–$50. Military/medical circular connectors can exceed $200.',
  },
  {
    id: 'breaker-electrical',
    label: 'Electrical protection & distribution (breakers, contactors, transformers)',
    keywords: ['circuit breaker', 'breaker', 'contactor', 'relay', 'fuse', 'transformer', 'disconnect', 'switchgear', 'transducer', 'current transformer'],
    typicalUsd: [5, 5000],
    notes: 'Miniature breakers $5–$100; molded-case and industrial breakers $100–$5000. Suspicious if a molded-case breaker is under $30.',
  },
  {
    id: 'drive-inverter',
    label: 'Drives, inverters & power conversion',
    keywords: ['inverter', 'drive', 'vfd', 'converter', 'acs800', 'servo', 'rectifier module', 'soft starter'],
    typicalUsd: [200, 50000],
    notes: 'Industrial drives/inverters are four to five figures. A $50 "ACS800 inverter" is a fragment, accessory, or fraud.',
  },
  {
    id: 'wind-renewable',
    label: 'Wind / renewable energy spares',
    keywords: ['wind', 'turbine', 'pitch', 'yaw', 'nacelle', 'rotor', 'slip ring', 'converter module', 'vestas', 'gamesa', 'nordex'],
    typicalUsd: [50, 100000],
    notes: 'Specialist market with few listed prices — most sales are quote-based. Treat any listed price as indicative.',
  },
  {
    id: 'it-hardware',
    label: 'IT / server / laptop hardware',
    keywords: ['server', 'laptop', 'notebook', 'motherboard', 'bezel', 'hinge', 'chassis', 'drive', 'hdd', 'ssd', 'memory', 'dimm', 'raid', 'nic', 'psu'],
    typicalUsd: [5, 3000],
    notes: 'Spares (hinges, bezels) $5–$100; boards and enterprise drives $100–$3000. Refurbished/pull condition is normal in this market.',
  },
  {
    id: 'medical',
    label: 'Medical equipment parts',
    keywords: ['mri', 'ultrasound', 'x-ray', 'patient', 'medical', 'probe', 'coil', 'sponge', 'surgical'],
    typicalUsd: [1, 50000],
    notes: 'Ranges are extreme: consumables are dollars, imaging spares are thousands. Certification/condition matters more than price.',
  },
  {
    id: 'electromechanical',
    label: 'Electromechanical & industrial (motors, sensors, pneumatics, bearings)',
    keywords: ['motor', 'gearbox', 'bearing', 'sensor', 'encoder', 'valve', 'cylinder', 'pump', 'actuator', 'coupling'],
    typicalUsd: [5, 20000],
    notes: 'Proximity sensors $30–$300; servo motors and gearboxes reach thousands.',
  },
  {
    id: 'sbc-maker',
    label: 'Single-board computers & dev boards',
    keywords: ['raspberry pi', 'arduino', 'dev board', 'development board', 'esp32', 'beaglebone', 'jetson'],
    typicalUsd: [4, 400],
    notes: 'MSRPs are well known (Pi Zero $5–$15, Pi 5 $60–$120). Scalper premiums of 2–3x appear during shortages; flag beyond that.',
  },
];

/** Best-effort category detection from part description text. */
export function categorizePart(text: string | null | undefined): PartCategory | null {
  if (!text) return null;
  const lower = text.toLowerCase();
  let best: { category: PartCategory; hits: number } | null = null;
  for (const category of PART_CATEGORIES) {
    const hits = category.keywords.filter((kw) => lower.includes(kw)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { category, hits };
  }
  return best?.category ?? null;
}

/* ------------------------------------------------------------------ */
/* Risk & counterfeit heuristics                                       */
/* ------------------------------------------------------------------ */

export const RISK_SIGNALS: string[] = [
  'Price far below every reputable distributor for an in-demand or obsolete part (classic counterfeit lure).',
  'Marketplace seller with generic storefront selling high-value industrial modules (IGBTs, drives) at retail-gadget prices.',
  'Stock quantities in the tens of thousands for parts that are end-of-life or allocated.',
  'Description copied verbatim from the manufacturer datasheet with no seller-specific details.',
  'No manufacturer stated, or manufacturer contradicts the part-number prefix convention.',
  '"New" condition claimed for parts only produced decades ago (should be new-old-stock or refurbished).',
  'Only payment methods with no buyer protection (wire transfer, crypto).',
];

/* ------------------------------------------------------------------ */
/* Prompt composition                                                  */
/* ------------------------------------------------------------------ */

/**
 * Compose a compact domain-knowledge context block for AI prompts,
 * tuned to the detected part category.
 */
export function buildDomainContext(input: {
  mpn?: string | null;
  manufacturer?: string | null;
  description?: string | null;
}): string {
  const category = categorizePart(
    [input.description, input.mpn].filter(Boolean).join(' '),
  );
  const lines: string[] = [
    'DOMAIN KNOWLEDGE (DEX procurement):',
  ];
  if (category) {
    lines.push(
      `- Part category: ${category.label}.`,
      `- Typical unit price range: $${category.typicalUsd[0]}–$${category.typicalUsd[1]} USD. ${category.notes}`,
    );
  }
  if (input.manufacturer) {
    const canonical = canonicalManufacturer(input.manufacturer);
    lines.push(
      `- Manufacturer "${input.manufacturer}" (canonical: ${canonical}) may appear under aliases, former names, or abbreviations; treat those as the same company.`,
    );
  }
  lines.push(
    '- Vendors quote per-unit, per-lot, and quote-only ("RFQ") pricing; never compare a lot price to a unit price directly.',
    '- Condition vocabulary: new, new-old-stock (NOS), refurbished, used/pull, repair/exchange — condition changes fair price by 2–10x.',
    `- Counterfeit/risk patterns: ${RISK_SIGNALS.slice(0, 3).join(' ')}`,
  );
  return lines.join('\n');
}
