// Where each standard the blueprints teach is published, so every code on a blueprint page can link to
// its source. Checked on 2026-11-27:
//  - NGSS: one page per performance expectation on nextgenscience.org (each address was opened).
//  - Common Core: corestandards.org now publishes only the two PDFs, so a code links to the page of the
//    PDF it is printed on (each was found by the standard's own wording).
//  - C3: the framework's page at the National Council for the Social Studies (its indicators have no pages).
// A code that is not listed here is shown without a link, and the build still passes.

export type FrameworkKey = 'ngss' | 'ccss-math' | 'ccss-ela' | 'c3';

export interface Framework {
  name: string;
  short: string;
  color: string;
  /** The framework's own front page. */
  home: string;
  /** How a code's link is made, in a sentence for the standards page. */
  links: string;
}

export const FRAMEWORKS: Record<FrameworkKey, Framework> = {
  ngss: {
    name: 'Next Generation Science Standards',
    short: 'NGSS',
    color: '#2fb344',
    home: 'https://www.nextgenscience.org/',
    links: 'Each code opens that performance expectation on nextgenscience.org.',
  },
  'ccss-math': {
    name: 'Common Core State Standards: Mathematics',
    short: 'Common Core Maths',
    color: '#339af0',
    home: 'https://corestandards.org/',
    links: 'Each code opens the official PDF at the page the standard is printed on.',
  },
  'ccss-ela': {
    name: 'Common Core State Standards: English Language Arts and Literacy',
    short: 'Common Core ELA',
    color: '#e64980',
    home: 'https://corestandards.org/',
    links: 'Each code opens the official PDF at the page the standard is printed on.',
  },
  c3: {
    name: 'C3 Framework for Social Studies State Standards',
    short: 'C3',
    color: '#15aabf',
    home: 'https://www.socialstudies.org/c3',
    links: 'The indicators have no pages of their own, so each code opens the framework.',
  },
};

const CCSS_MATH_PDF = 'https://corestandards.org/wp-content/uploads/2023/09/Math_Standards1.pdf';
const CCSS_ELA_PDF = 'https://corestandards.org/wp-content/uploads/2023/09/ELA_Standards1.pdf';

/** NGSS performance expectation -> the rest of its address (the topic it belongs to). */
const NGSS: Record<string, string> = {
  '1-ESS1-1': "earths-place-universe",
  '1-ESS1-2': "earths-place-universe",
  '1-PS4-2': "waves-and-their-applications-technologies-information-transfer",
  '1-PS4-3': "waves-and-their-applications-technologies-information-transfer",
  '1-PS4-4': "waves-and-their-applications-technologies-information-transfer",
  'K-2-ETS1-1': "engineering-design",
  '2-LS2-2': "ecosystems-interactions-energy-and-dynamics",
  '2-LS2-1': "ecosystems-interactions-energy-and-dynamics",
  '2-LS4-1': "biological-evolution-unity-and-diversity",
  '3-ESS2-1': "earths-systems",
  '3-ESS2-2': "earths-systems",
  '3-ESS3-1': "earth-and-human-activity",
  '4-ESS1-1': "earths-place-universe",
  '3-LS4-1': "biological-evolution-unity-and-diversity",
  '4-ESS2-1': "earths-systems",
  '3-5-ETS1-1': "engineering-design",
  '3-5-ETS1-2': "engineering-design",
  '3-5-ETS1-3': "engineering-design",
  '3-PS2-1': "motion-and-stability-forces-and-interactions",
  '5-LS2-1': "ecosystems-interactions-energy-and-dynamics",
  '5-PS3-1': "energy",
  '5-LS1-1': "molecules-organisms-structures-and-processes",
  '5-PS1-2': "matter-and-its-interactions",
  '5-PS1-4': "matter-and-its-interactions",
  '5-PS1-3': "matter-and-its-interactions",
  'MS-LS4-4': "biological-evolution-unity-and-diversity",
  'MS-LS4-6': "biological-evolution-unity-and-diversity",
  'MS-LS3-2': "heredity-inheritance-and-variation-traits",
  'MS-PS2-4': "motion-and-stability-forces-and-interactions",
  'MS-PS3-2': "energy",
  'MS-ESS1-1': "earths-place-universe",
  'MS-ESS2-3': "earths-systems",
  'MS-ESS2-2': "earths-systems",
  'MS-ESS1-4': "earths-place-universe",
  'HS-LS2-1': "ecosystems-interactions-energy-and-dynamics",
  'HS-PS1-7': "matter-and-its-interactions",
  'HS-ESS3-4': "earth-and-human-activity",
  '5-ESS1-2': "earths-place-universe",
  '5-PS1-1': "matter-and-its-interactions",
  '5-PS2-1': "motion-and-stability-forces-and-interactions",
  'MS-LS2-1': "ecosystems-interactions-energy-and-dynamics",
  'MS-PS1-2': "matter-and-its-interactions",
};

/** Common Core maths standard -> the page of the mathematics PDF. */
const CCSS_MATH: Record<string, number> = {
  '1.MD.A.1': 16,
  '1.MD.B.3': 16,
  '1.MD.C.4': 16,
  '2.MD.D.10': 20,
  '3.NF.A.1': 24,
  '3.NF.A.2': 24,
  '3.NF.A.3': 24,
  '4.NF.A.2': 30,
  '3.OA.D.8': 23,
  '4.MD.A.2': 31,
  '3.MD.B.3': 25,
  '4.OA.A.3': 29,
  '5.G.A.1': 38,
  '5.G.A.2': 38,
  '5.OA.B.3': 35,
  '6.NS.C.6c': 43,
  '6.NS.C.8': 43,
  '5.NBT.B.7': 35,
  '6.RP.A.1': 42,
  '6.RP.A.2': 42,
  '6.RP.A.3': 42,
  '7.RP.A.2': 48,
  '7.SP.C.6': 51,
  '7.SP.C.7': 51,
  '7.SP.C.8': 51,
  '7.SP.A.1': 50,
  '7.SP.A.2': 50,
  '8.SP.A.4': 56,
  '6.SP.B.5': 45,
  '6.EE.C.9': 44,
  '8.F.B.5': 55,
  'HSF-LE.A.1': 70,
  'HSF-LE.A.3': 71,
  'HSF-IF.B.4': 69,
  'HSN-Q.A.1': 60,
  'HSA-CED.A.4': 65,
};

/** Common Core ELA and literacy standard -> the page of the ELA PDF. */
const CCSS_ELA: Record<string, number> = {
  'RI.4.7': 14,
  'L.4.4a': 29,
  'L.4.4b': 29,
  'L.5.4b': 29,
  'RF.4.3a': 17,
  'RL.4.6': 12,
  'RL.5.6': 12,
  'RL.4.3': 12,
  'RL.4.1': 12,
  'W.4.3': 20,
  'RST.6-8.7': 62,
  'RST.6-8.1': 62,
  'RH.6-8.1': 61,
  'RH.6-8.6': 61,
  'RH.6-8.8': 61,
  'RH.6-8.9': 61,
  'RI.6.8': 39,
  'RI.7.8': 39,
  'RI.8.8': 39,
  'SL.8.2': 49,
  'W.7.8': 44,
  'SL.1.1': 23,
};

export interface StandardLink {
  code: string;
  framework: FrameworkKey | null;
  url: string | null;
  /** What opening the link shows, for its title. */
  opens: string;
}

/** The framework a code belongs to and where to read it. */
export function standard(code: string): StandardLink {
  if (code in NGSS) {
    return { code, framework: 'ngss', url: `https://www.nextgenscience.org/pe/${code.toLowerCase()}-${NGSS[code]}`, opens: `${code} on nextgenscience.org` };
  }
  if (code in CCSS_MATH) {
    return { code, framework: 'ccss-math', url: `${CCSS_MATH_PDF}#page=${CCSS_MATH[code]}`, opens: `${code} in the Common Core mathematics standards (PDF, page ${CCSS_MATH[code]})` };
  }
  if (code in CCSS_ELA) {
    return { code, framework: 'ccss-ela', url: `${CCSS_ELA_PDF}#page=${CCSS_ELA[code]}`, opens: `${code} in the Common Core ELA standards (PDF, page ${CCSS_ELA[code]})` };
  }
  if (code.startsWith('D2.')) {
    return { code, framework: 'c3', url: FRAMEWORKS.c3.home, opens: 'The C3 Framework at the National Council for the Social Studies' };
  }
  return { code, framework: null, url: null, opens: code };
}

/** Other curricula the blueprints name by topic, with each one's own front page. */
export const OTHER_CURRICULA = [
  { name: 'National curriculum in England', url: 'https://www.gov.uk/government/collections/national-curriculum' },
  { name: 'Ontario curriculum', url: 'https://www.dcp.edu.gov.on.ca/en/' },
  { name: 'Texas Essential Knowledge and Skills', url: 'https://tea.texas.gov/curriculum-and-instruction/texas-essential-knowledge-and-skills-teks' },
];
