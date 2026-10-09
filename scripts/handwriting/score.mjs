// Scores a model's LaTeX transcription of a handwritten page against the answer key.
// Both sides are normalized so spacing and equivalent spellings (\le vs \leq, \dfrac vs
// \frac, \left( vs () don't count as misreadings; what's left is compared character by
// character.

// Symbol spacing (\, \; \: \! and backslash-space) may sit right before a letter, as in \,dx; word
// commands (\quad) may not, or \quadratic would match. The \\ row break is not spacing.
const SPACING = /(?<!\\)\\(?:[,;:! ]|(?:quad|qquad|enspace|thinspace|medspace|thickspace)(?![a-zA-Z]))|~/g;

const SYNONYMS = [
  [/\\(?:d|t)frac(?![a-zA-Z])/g, '\\frac'],
  [/\\leq(?![a-zA-Z])/g, '\\le'],
  [/\\geq(?![a-zA-Z])/g, '\\ge'],
  [/\\neq(?![a-zA-Z])/g, '\\ne'],
  [/\\(?:Rightarrow|implies)(?![a-zA-Z])/g, '\\implies'],
  [/\\(?:Leftrightarrow|iff)(?![a-zA-Z])/g, '\\iff'],
  [/\\(?:rightarrow|to)(?![a-zA-Z])/g, '\\to'],
  [/\\epsilon(?![a-zA-Z])/g, '\\varepsilon'],
  [/\\varphi(?![a-zA-Z])/g, '\\phi'],
  [/\\(?:ldots|cdots|dots)(?![a-zA-Z])/g, '\\dots'],
  [/\\(?:lnot|neg)(?![a-zA-Z])/g, '\\neg'],
  [/\\(?:land|wedge)(?![a-zA-Z])/g, '\\land'],
  [/\\(?:lor|vee)(?![a-zA-Z])/g, '\\vee'],
  [/\\(?:varnothing|emptyset)(?![a-zA-Z])/g, '\\emptyset'],
  [/\\(?:mathrm|operatorname)\{([^{}]*)\}/g, '$1'],
  [/\\(?:text|textbf|textit|mathrm|mbox)\{([^{}]*)\}/g, '$1'],
  [/\\(?:left|right|big|Big|bigg|Bigg)(?![a-zA-Z])/g, ''],
  [/\\(?:displaystyle|limits)(?![a-zA-Z])/g, ''],
  [/\\(?:blacksquare|square|qed|Box)(?![a-zA-Z])/g, '\\qed'],
  [/\\colon(?![a-zA-Z])/g, ':'],
];

export function normalizeLatex(line) {
  let s = String(line).trim();
  // Delimiters a model may add despite the prompt.
  s = s.replace(/^(?:\\\[|\\\()|(?:\\\]|\\\))$/g, '').replace(/\$/g, '');
  s = s.replace(/\\(?:begin|end)\{(?:align\*?|aligned|equation\*?)\}/g, '');
  // Alignment points mean nothing outside a matrix or cases.
  if (!/\\begin\{(?:[pbvBV]?matrix|cases|array)\}/.test(s)) s = s.replace(/&/g, '');
  for (const [pattern, replacement] of SYNONYMS) s = s.replace(pattern, replacement);
  s = s.replace(SPACING, '');
  // Single-token groups: x^{2} and x^2 are the same.
  s = s.replace(/([_^])\{([^{}\\])\}/g, '$1$2');
  // A fraction of plain numbers or letters written inline: 3/2 and \frac{3}{2} are the same.
  // Rewritten as \frac so the numerator and denominator keep their boundaries.
  s = s.replace(/(?<![\w}])(\w+)\s*\/\s*(\w+)(?![\w{\\])/g, '\\frac{$1}{$2}');
  return s.replace(/\s+/g, '');
}

export function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

/** 1 for identical after normalizing, 0 for nothing in common. */
export function similarity(expected, actual) {
  const a = normalizeLatex(expected);
  const b = normalizeLatex(actual);
  if (a.length === 0 && b.length === 0) return 1;
  return 1 - editDistance(a, b) / Math.max(a.length, b.length);
}

/** The model's reply as transcribed lines, without fences, blank lines or a DIAGRAM note. */
export function transcriptionLines(text) {
  return String(text)
    .replace(/```[a-z]*\n?/gi, '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^DIAGRAM:/i.test(line));
}

// A matrix, cases block or tall fraction may come back over several output lines.
const MAX_SPAN = 3;

/**
 * Matches key lines to transcribed lines in order (a missed line costs only that line; a key
 * line may match up to MAX_SPAN consecutive transcribed lines joined) and returns each key
 * line's best similarity plus the page's mean.
 */
export function scorePage(keyLines, transcribed) {
  const n = keyLines.length;
  const m = transcribed.length;
  // sim[i][j][k - 1]: key line i against transcribed lines j..j+k-1 joined.
  const sim = keyLines.map((key) => transcribed.map((_, j) => {
    const spans = [];
    for (let k = 1; k <= MAX_SPAN && j + k <= m; k++) spans.push(similarity(key, transcribed.slice(j, j + k).join(' ')));
    return spans;
  }));
  // best[i][j]: highest total for key lines i.. using transcribed lines j..
  const best = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m; j >= 0; j--) {
      let value = best[i + 1][j];
      if (j < m) {
        value = Math.max(value, best[i][j + 1]);
        sim[i][j].forEach((score, k) => { value = Math.max(value, score + best[i + 1][j + k + 1]); });
      }
      best[i][j] = value;
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    const k = j < m ? sim[i][j].findIndex((score, span) => best[i][j] === score + best[i + 1][j + span + 1]) : -1;
    if (k >= 0) {
      lines.push({ expected: keyLines[i], got: transcribed.slice(j, j + k + 1).join(' '), score: sim[i][j][k] });
      i++;
      j += k + 1;
    } else if (j < m && best[i][j] === best[i][j + 1]) {
      j++;
    } else {
      lines.push({ expected: keyLines[i], got: null, score: 0 });
      i++;
    }
  }
  const score = n === 0 ? 1 : lines.reduce((sum, l) => sum + l.score, 0) / n;
  return { score, exact: lines.filter((l) => l.score === 1).length, lines };
}
