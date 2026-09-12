/**
 * Generates a large, well structured markdown spec for benchmarking: nested
 * headings, prose with concept references at a realistic density, and
 * `#### $.a.b` definitions. Seeded, so every run measures the same document.
 */

function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORIES = [
  'screens', 'components', 'apis', 'models', 'events', 'errors', 'flows', 'permissions',
  'settings', 'jobs', 'metrics', 'storage', 'auth', 'billing', 'notifications',
];

const SYLLABLES = ['Ac', 'Bar', 'Cor', 'Dex', 'Emb', 'Fil', 'Gra', 'Hub', 'Ion', 'Jet', 'Key', 'Lum',
  'Mod', 'Nex', 'Orb', 'Pix', 'Qua', 'Rex', 'Syn', 'Tor', 'Uni', 'Vox', 'Wav', 'Xen', 'Yar', 'Zed'];

const WORDS = ('the a an and or of to in on for with by from as at is are be was were this that these ' +
  'those it its user users app system service request response data value state screen page flow step ' +
  'when then if else must should may can will not only each every all any some more less first last ' +
  'next previous before after during while until unless shows sends stores loads saves checks validates ' +
  'returns creates updates deletes handles renders opens closes starts ends retries fails succeeds ' +
  'error success token session account device browser network cache queue event message record field ' +
  'list item entry key id name label title description status result input output format version').split(' ');

export interface Spec {
  text: string;
  words: number;
  references: number;
  definitions: number;
  concepts: number;
}

export function generateSpec(targetWords = 50_000, seed = 42): Spec {
  const random = mulberry32(seed);
  const pick = <T>(items: readonly T[]) => items[Math.floor(random() * items.length)];

  // ~15 categories x 25 concepts, a third of them with three children.
  const paths: string[] = [];
  for (const category of CATEGORIES) {
    for (let i = 0; i < 25; i++) {
      const name = pick(SYLLABLES) + pick(SYLLABLES) + i;
      paths.push(`${category}.${name}`);
      if (random() < 0.33) {
        for (let j = 0; j < 3; j++) {
          paths.push(`${category}.${name}.${pick(SYLLABLES).toLowerCase()}${j}`);
        }
      }
    }
  }

  const out: string[] = [];
  let words = 0;
  let references = 0;
  let definitions = 0;
  let nextToDefine = 0;

  const paragraph = (length: number) => {
    const tokens: string[] = [];
    for (let i = 0; i < length; i++) {
      if (random() < 1 / 25) {
        tokens.push(`$.${pick(paths)}` + (random() < 0.3 ? pick([',', '.', ';']) : ''));
        references++;
      } else {
        tokens.push(pick(WORDS));
      }
    }
    words += length;
    return tokens.join(' ');
  };

  for (let section = 1; words < targetWords; section++) {
    out.push(`# Section ${section}`, '', paragraph(40), '');
    words += 2;
    for (let sub = 1; sub <= 5 && words < targetWords; sub++) {
      out.push(`## Part ${section}.${sub}`, '', paragraph(35), '');
      words += 2;
      for (let topic = 1; topic <= 3 && words < targetWords; topic++) {
        out.push(`### Topic ${section}.${sub}.${topic}`, '', paragraph(50), '', paragraph(45), '');
        words += 2;

        if (random() < 0.45 && nextToDefine < paths.length) {
          out.push(`#### $.${paths[nextToDefine++]}`, '', paragraph(40), '', paragraph(25));
          definitions++;
          words += 2;
          out.push(random() < 0.5 ? '---' : '', '');
        }
      }
    }
  }

  return { text: out.join('\n') + '\n', words, references, definitions, concepts: paths.length };
}
