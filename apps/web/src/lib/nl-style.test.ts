import { describe, expect, it } from "vitest";
import nl from "../../locales/nl.json";

// Dutch UI text is sentence case: only the first word of a label or sentence starts with a
// capital, plus names (UX-65). English Title Case carried over into nl.json ("Puzzel
// Toevoegen", "Te Ruil", "Pagina Niet Gevonden") is what this guards against.
//
// Two rules, so that a sentence can still name a control by its label ("Druk op Puzzel
// toevoegen", "Kies Ruilen, Lenen of Kopen"):
// - in a label (a heading, button or title: no full stop, at most 8 words per part) no word
//   but the first may start with a capital;
// - in a sentence no capitalised word may directly follow another one, apart from the
//   first word (a Title Case run such as "Druk op Puzzel Toevoegen").
// Names (PROPER_NOUNS), acronyms and text inside quotes or <b> (another UI's label, quoted
// verbatim) are not checked.

// Names, brands, places, organisations and key names that keep their capital.
const PROPER_NOUNS = new Set([
  "JigSwap",
  "Ravensburger",
  "Clementoni",
  "Jan",
  "Haasteren",
  "Wasgij",
  "Europese",
  "Unie",
  "Autoriteit",
  "Persoonsgegevens",
  "Meldpunt",
  "Offlimits",
  "Nederland",
  "Nederlands",
  "Engels",
  "Engelse",
  "Verenigde",
  "Staten",
  "Frankrijk",
  "Parijs",
  "Canada",
  "Zwitserland",
  "Kozelo",
  "Sander",
  "Verkuil",
  "Jansen",
  "Clerk",
  "Convex",
  "Vercel",
  "PostHog",
  "Axiom",
  "Sightengine",
  "MapTiler",
  "AhaSend",
  "Firecrawl",
  "Google",
  "Apple",
  "Brave",
  "Chrome",
  "Chromium",
  "Firefox",
  "Safari",
  "Edge",
  "Helium",
  "WebP",
  "Enter",
]);

// Labels that name another control or a user-data example mid-label, with the words they
// may capitalise. A key ending in "." covers its whole namespace.
const ALLOWED: Record<string, readonly string[]> = {
  // The defined term of the terms of use: "deze algemene voorwaarden ('Voorwaarden')".
  "terms.": ["Voorwaarden"],
  // The household permission options, by name.
  "household.bulkPermission.setManage": ["Mag"],
  "household.bulkPermission.setView": ["Alleen"],
  // The What's new panel, by name.
  "whatsNew.announce": ["Wat"],
  // An example series name, written as a publisher would.
  "forms.puzzle-form.series.placeholder": ["Collectie"],
};

type Leaf = readonly [key: string, value: string];

function leaves(node: unknown, prefix = ""): Leaf[] {
  if (typeof node === "string") return [[prefix, node]];
  if (Array.isArray(node))
    return node.flatMap((item, i) => leaves(item, `${prefix}.${i}`));
  if (node && typeof node === "object")
    return Object.entries(node).flatMap(([key, value]) =>
      leaves(value, prefix ? `${prefix}.${key}` : key),
    );
  return [];
}

// Splits an ICU message into its plain-text runs. Each plural/select branch is a run of its
// own (it starts its own phrase); any argument becomes the neutral word "§".
function textRuns(message: string): string[] {
  const runs: string[] = [];
  let i = 0;

  const skipUntil = (stops: string) => {
    let out = "";
    while (i < message.length && !stops.includes(message[i]))
      out += message[i++];
    return out.trim();
  };

  const argument = (): string => {
    i++; // "{"
    skipUntil(",}");
    if (message[i++] === "}") return "§";
    const type = skipUntil(",}");
    if (message[i++] === "}") return "§";
    if (!/^(plural|select|selectordinal)$/.test(type)) {
      skipUntil("}");
      i++;
      return "§";
    }
    for (;;) {
      skipUntil("{}");
      if (message[i++] === "}") return "§";
      runs.push(text(true));
    }
  };

  const text = (inBranch: boolean): string => {
    let out = "";
    while (i < message.length) {
      const ch = message[i];
      if (ch === "}" && inBranch) {
        i++;
        return out;
      }
      if (ch === "{") out += argument();
      else {
        out += ch;
        i++;
      }
    }
    return out;
  };

  runs.unshift(text(false));
  return runs;
}

const QUOTED =
  /“[^”]*”|„[^”"]*[”"]|"[^"]*"|‘[^’]*’|(^|[\s(])'[^'\s][^']*'(?=[\s.,;:!?)]|$)/g;

// Drops what is not checked: <b> labels, tags and quoted labels.
const checkable = (run: string) =>
  run
    .replace(/<b>[\s\S]*?<\/b>/g, "§")
    .replace(/<\/?\w+>/g, " ")
    .replace(QUOTED, "$1§");

const SEGMENT = /(?<=[.!?;:…])\s+|\s[—–·•|]\s|\n+/;
const SENTENCE = /\.(\s|$)|[!?]\s/;
const strip = (token: string) =>
  token.replace(/^[^\p{L}\p{N}§#]+|[^\p{L}\p{N}§#]+$/gu, "");
const capitalised = (word: string) => /^\p{Lu}/u.test(word);
// "QR-code", "EU-hosting", "JSON": an acronym keeps its capitals.
const acronym = (word: string) => /^[\p{Lu}\d]{2,}(?!\p{Ll})/u.test(word);

function allowedFor(key: string): readonly string[] {
  return Object.entries(ALLOWED).flatMap(([pattern, words]) =>
    pattern.endsWith(".")
      ? key.startsWith(pattern)
        ? words
        : []
      : pattern === key
        ? words
        : [],
  );
}

// The capitalised non-initial words in one message that break sentence case.
function titleCaseWords(key: string, message: string): string[] {
  const allowed = allowedFor(key);
  const exempt = (word: string) =>
    acronym(word) ||
    PROPER_NOUNS.has(word.split("-")[0]) ||
    allowed.includes(word);
  const hits: string[] = [];
  for (const run of textRuns(message).map(checkable)) {
    const sentence = SENTENCE.test(run);
    for (const segment of run.split(SEGMENT)) {
      const tokens = segment.split(/\s+/).filter(Boolean);
      const label = !sentence && tokens.length <= 8;
      let index = 0;
      let previous: { word: string; joined: boolean; index: number } | null =
        null;
      for (const token of tokens) {
        const word = strip(token);
        if (!word) {
          previous = null;
          continue;
        }
        const titleRun =
          previous !== null &&
          previous.joined &&
          previous.index > 0 &&
          capitalised(previous.word) &&
          !/^[(«"'‘“„]/.test(token);
        if (
          index > 0 &&
          capitalised(word) &&
          !exempt(word) &&
          (label || titleRun)
        )
          hits.push(word);
        previous = { word, joined: !/[^\p{L}\p{N}]$/u.test(token), index };
        index++;
      }
    }
  }
  return hits;
}

describe("nl-style helpers", () => {
  it("splits ICU branches into their own runs", () => {
    expect(
      textRuns(
        "{n, plural, one {Snelle acties, # update} other {# updates}} nu",
      ),
    ).toEqual(["§ nu", "Snelle acties, # update", "# updates"]);
  });

  it.each([
    ["Puzzel Toevoegen", ["Toevoegen"]],
    ["Markeren als Voltooid", ["Voltooid"]],
    ["{rating} Vertrouwen", ["Vertrouwen"]],
    ["Mijn Bibliotheek — JigSwap", ["Bibliotheek"]],
    ["Druk op Puzzel Toevoegen om te beginnen.", ["Toevoegen"]],
    ["Druk op Puzzel toevoegen om te beginnen.", []],
    ["Kies Ruilen, Lenen of Kopen.", []],
    ["Gebruik Melden bij een bericht.", []],
    ["Waarom JigSwap kiezen?", []],
    ["📚 Persoonlijke puzzelbibliotheek", []],
    ["Kies <b>App installeren</b>", []],
    ["Zet 'Google-services gebruiken' aan.", []],
    ["Bewaard in de EU-regio van Convex", []],
    ["Je foto's en QR-codes", []],
  ] as const)("%s → %j", (message, expected) => {
    expect(titleCaseWords("x", message)).toEqual(expected);
  });
});

describe("nl.json", () => {
  it("is sentence case outside names and quoted labels", () => {
    const offenders = leaves(nl)
      .map(([key, value]) => [key, value, titleCaseWords(key, value)] as const)
      .filter(([, , hits]) => hits.length > 0)
      .map(([key, value, hits]) => `${key}: ${value}  [${hits.join(", ")}]`);
    expect(offenders).toEqual([]);
  });
});
