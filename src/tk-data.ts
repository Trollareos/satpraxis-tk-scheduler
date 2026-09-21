export type ResultStatus = "confirmed" | "trend" | "unknown";

export type SearchResult = {
  postcode: string;
  group: string;
  direct: string[];
  indirect: string[];
  excluded: string[];
  note: string;
  confidence: string;
  status: ResultStatus;
};

type RuleResult = Omit<SearchResult, "postcode">;
type SpecialRule = RuleResult & { postcode: string; exclusive?: boolean };
type GroupRule = {
  matches: (postcode: string) => boolean;
  resolve: (postcode: string) => RuleResult;
};

const expand = (prefix: string, start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) =>
    `${prefix}${String(start + index).padStart(2, "0")}`,
  );

const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
const without = (values: string[], postcode: string) => values.filter((value) => value !== postcode);
const exactSet = (values: string[]) => {
  const set = new Set(values);
  return (postcode: string) => set.has(postcode);
};

const patternMatches = (postcode: string, rawPattern: string) => {
  const pattern = rawPattern.trim().replace(/[XΧχ]/g, "x").replace(/[–—]/g, "-");
  if (/^\d{5}$/.test(pattern)) return postcode === pattern;
  if (/^[\dxX]{5}$/.test(pattern)) {
    return new RegExp(`^${pattern.replace(/[xX]/g, "\\d")}$`).test(postcode);
  }
  const fullRange = pattern.match(/^(\d{5})-(\d{5})$/);
  if (fullRange) return Number(postcode) >= Number(fullRange[1]) && Number(postcode) <= Number(fullRange[2]);
  const range = pattern.match(/^(\d{3})(\d{2})-(\d{2})$/);
  if (!range || !postcode.startsWith(range[1])) return false;
  const suffix = Number(postcode.slice(3));
  return suffix >= Number(range[2]) && suffix <= Number(range[3]);
};

const FAMILY_SEPARATION_NOTE = "Νέα οδηγία 06/09/2026: τα 104xx και 111xx δεν συνδυάζονται μεταξύ τους, σε καμία κατεύθυνση. Ο αποκλεισμός υπερισχύει των τάσεων και των παλαιότερων τοπικών ενημερώσεων.";

function excludedPostcodeFamily(postcode: string): string | null {
  if (/^104\d{2}$/.test(postcode)) return "111";
  if (/^111\d{2}$/.test(postcode)) return "104";
  return null;
}

export function isProhibitedPostcodePair(first: string, second: string): boolean {
  const excludedFamily = excludedPostcodeFamily(first);
  return excludedFamily !== null && new RegExp(`^${excludedFamily}\\d{2}$`).test(second);
}

// Apply after built-in rules and local overrides so an older broad rule cannot
// reintroduce the prohibited pair, including wildcard and range suggestions.
export function enforcePostcodeFamilySeparation(result: SearchResult): SearchResult {
  const excludedFamily = excludedPostcodeFamily(result.postcode);
  if (!excludedFamily) return result;
  const forbiddenPostcodes = expand(excludedFamily, 0, 99);
  const allowed = (pattern: string) => !forbiddenPostcodes.some((postcode) => patternMatches(postcode, pattern));
  return {
    ...result,
    direct: result.direct.filter(allowed),
    indirect: result.indirect.filter(allowed),
    excluded: unique([...result.excluded, `${excludedFamily}xx`]),
    note: result.note.includes(FAMILY_SEPARATION_NOTE) ? result.note : [result.note, FAMILY_SEPARATION_NOTE].filter(Boolean).join(" "),
  };
}

const confirmed = (rule: Omit<RuleResult, "status">): RuleResult => ({
  ...rule,
  status: "confirmed",
});

const special = (
  postcode: string,
  group: string,
  direct: string[],
  indirect: string[],
  excluded: string[],
  note: string,
  confidence = "Επιβεβαιωμένος κανόνας",
  exclusive = false,
): SpecialRule => ({
  postcode,
  exclusive,
  ...confirmed({ group, direct, indirect, excluded, note, confidence }),
});

const trendSpecial = (
  postcode: string,
  group: string,
  direct: string[],
  indirect: string[],
  excluded: string[],
  note: string,
  confidence = "Ισχυρή τάση προγράμματος",
): SpecialRule => ({
  postcode,
  group,
  direct,
  indirect,
  excluded,
  note,
  confidence,
  status: "trend",
});

const specialRules: SpecialRule[] = [
  special(
    "10435",
    "Ειδικός κανόνας 10435",
    ["118xx", "117xx"],
    [],
    [],
    "Ο ειδικός κανόνας υπερισχύει της γενικής ομάδας 104xx.",
  ),
  special(
    "10447",
    "Ειδικός κανόνας 10447",
    ["118xx", "117xx", "177xx", "178xx"],
    [],
    ["104xx", "111xx"],
    "Ο 10447 έχει αποκλειστικό ειδικό κανόνα με τις οικογένειες 118xx, 117xx, 177xx και 178xx. Δεν ταιριάζει με άλλους 104xx ή με 111xx.",
    "Νεότερος ρητός κανόνας",
    true,
  ),
  special(
    "11255",
    "Ειδικός κανόνας 11255",
    ["104xx", "111xx"],
    [],
    ["10447", "115xx"],
    "Ο 11255 συνδέεται ξεχωριστά με 104xx και 111xx· αυτό δεν συνδέει τις δύο οικογένειες μεταξύ τους. Εξαιρείται ο 10447. Τα 115xx ανήκουν στην ομάδα 115xx / 157xx.",
  ),
  special(
    "11256",
    "Ειδικός κανόνας 11256",
    ["104xx", "111xx", "113xx"],
    [],
    ["10435", "10447", "115xx"],
    "Ρητές εξαιρέσεις: ο 11256 δεν ταιριάζει με τους 10435 και 10447.",
  ),
  special(
    "11257",
    "Ειδικός κανόνας 11257",
    ["104xx", "111xx"],
    [],
    ["10447", "115xx"],
    "Ο 11257 συνδέεται ξεχωριστά με 104xx και 111xx· αυτό δεν συνδέει τις δύο οικογένειες μεταξύ τους. Εξαιρείται ο 10447. Τα 115xx ανήκουν στην ομάδα 115xx / 157xx.",
  ),
  special(
    "11364",
    "Ειδικός κανόνας 11364",
    ["112xx", "111xx"],
    [],
    [],
    "Ρητά επιβεβαιωμένη σύνδεση με τις οικογένειες 112xx και 111xx.",
  ),
  special(
    "11635",
    "Ειδικός κανόνας 11635",
    ["161xx", "162xx"],
    [],
    ["115xx"],
    "Δεν γενικεύεται αυτόματα σε κάθε 116xx και δεν συνδέεται με τα 115xx.",
  ),
  trendSpecial(
    "11632",
    "11632 • Ομάδα 116 / 161 / 162 / 172",
    ["11633", "11634", "16121", "16122", "16231", "16232", "17237"],
    ["11635", "11636", "16233"],
    ["115xx"],
    "Και οι 9 καταγεγραμμένες αναθέσεις του 11632 εμφανίζονται μαζί με μέλος της καθιερωμένης ομάδας 116 / 161 / 162 / 172. Οι 11635, 11636 και 16233 παραμένουν εναλλακτικές λόγω ειδικών ή περιορισμένων κανόνων.",
  ),
  special(
    "11852",
    "Στενός κανόνας 11852",
    ["11853", "10447", "17778", "11741"],
    ["17122", "17124", "17673", "17675"],
    [],
    "Στενός λειτουργικός κανόνας· δεν επεκτείνεται σε όλους τους 117xx ή 178xx.",
    "Επιβεβαιωμένος + πρόγραμμα",
  ),
  special(
    "11853",
    "Ειδικός κανόνας 11853",
    ["117xx", "10435", "10437"],
    [],
    [],
    "Χρησιμοποιείται ο συγκεκριμένος ειδικός κανόνας.",
  ),
  special(
    "12131",
    "12131 • Δυτικός τομέας",
    ["12462", "12461", "12243"],
    ["12242", "13121", "13123", "13451"],
    [],
    "Άμεσα από την εικόνα και το πρόγραμμα: 12462, 12461, 12243. Έμμεσα από κοινή ημέρα και τεχνικό στα spreadsheets Ιουλίου–Αυγούστου 2026: 12242, 13121, 13123, 13451. Οι έμμεσες τιμές αποτελούν τάση προγράμματος και όχι ξεχωριστά χειροκίνητα επιβεβαιωμένο κανόνα.",
    "Επιβεβαιωμένο από εικόνα • πρόσθετες τάσεις από πρόγραμμα",
  ),
  special(
    "12137",
    "Ειδικός κανόνας 12137",
    ["1246x", "1224x"],
    [],
    [],
    "Ρητά επιβεβαιωμένη σύνδεση με 1246x και 1224x.",
  ),
  special(
    "13122",
    "Ειδικός κανόνας 13122",
    ["1345x", "1346x", "1323x", "1356x"],
    [],
    ["13121"],
    "Δεν επεκτείνεται αυτόματα στον 13121.",
  ),
  special(
    "13344",
    "Ειδικός κανόνας 13344",
    ["134xx", "1323x", "133xx"],
    [],
    [],
    "Περιλαμβάνει ειδικά τις οικογένειες 1345x και 1346x.",
  ),
  special(
    "13562",
    "Ειδικός κανόνας 13562",
    ["13561", "13556"],
    ["10441–10446", "11141–11147"],
    [],
    "Η σύνδεση με 104xx / 111xx είναι δευτερεύουσα χειρόγραφη σημείωση.",
    "Χειρόγραφος κανόνας",
  ),
  ...["13671", "13676", "13679"].map((postcode) =>
    special(
      postcode,
      `Ειδικός κανόνας ${postcode}`,
      ["134xx", "1323x", "133xx"],
      [],
      [],
      "Περιλαμβάνει ειδικά τις οικογένειες 1345x και 1346x.",
    ),
  ),
  trendSpecial(
    "13672",
    "13672 • Τάση προς ομάδα 141 / 142 / 143 / 144",
    ["14121", "14122", "14123", "14231", "14232", "14233", "14234", "14235", "14341", "14342", "14343", "14451", "14452"],
    ["13674"],
    [],
    "Σε 6 από τις 9 αναθέσεις του 13672 εμφανίζεται η καθιερωμένη ομάδα 141 / 142 / 143 / 144. Ο 13674 εμφανίζεται ως δευτερεύουσα εναλλακτική.",
  ),
  trendSpecial(
    "13673",
    "13673 / 13674 • Επαναλαμβανόμενη δυάδα",
    ["13674"],
    ["13676", "13679"],
    [],
    "Οι 13673 και 13674 εμφανίζονται μαζί σε 4 κοινές αναθέσεις. Οι 13676 και 13679 καταγράφονται ως δευτερεύουσες συνδέσεις της ίδιας οικογένειας.",
  ),
  trendSpecial(
    "13674",
    "13673 / 13674 • Επαναλαμβανόμενη δυάδα",
    ["13673"],
    ["13676", "13679"],
    [],
    "Οι 13673 και 13674 εμφανίζονται μαζί σε 4 κοινές αναθέσεις. Οι 13676 και 13679 καταγράφονται ως δευτερεύουσες συνδέσεις της ίδιας οικογένειας.",
  ),
  special(
    "13677",
    "Περιορισμένος κανόνας 13677",
    ["13676", "13679"],
    ["13671"],
    [],
    "Μικρό δείγμα· δεν επεκτείνεται αυτόματα σε όλη την οικογένεια 1367x.",
    "Περιορισμένη τάση",
  ),
  special(
    "15349",
    "Περιορισμένος κανόνας 15349",
    ["15351", "15344", "15354"],
    [],
    ["Αυτόματη επέκταση στους 190xx"],
    "Ταιριάζει μόνο με τους τρεις καταγεγραμμένους 153xx· όχι αυτόματα με 190xx.",
  ),
  special(
    "17341",
    "Ειδικός κανόνας 17341",
    ["1712x", "17670–17674", "17676–17679"],
    [],
    ["17675"],
    "Ο 17675 αφαιρέθηκε ρητά από τον παλιό γενικό κανόνα.",
  ),
  special(
    "17672",
    "17672 • Ομάδα 1712x / 17341",
    ["17341", "17121", "17122", "17123", "17124"],
    ["17671", "17673", "17675", "17676", "1185x", "1174x"],
    [],
    "Ο 17672 ανήκει στο επιβεβαιωμένο εύρος 17670–17674 που συνδέεται με τον 17341. Στα προγράμματα Ιουλίου–Αυγούστου 2026 εμφανίζεται συχνά με 17124 (10/22 αναθέσεις), 17675 (7/22), 17123 (6/22), 17121 (5/22), 17341 και 17122 (4/22). Ο 17675 παραμένει ξεχωριστός ειδικός κανόνας και εμφανίζεται εδώ μόνο ως έμμεση επιλογή. Οι 17671, 17673, 17676, 1185x και 1174x είναι δευτερεύουσες τάσεις προγράμματος.",
    "Επιβεβαιωμένος κανόνας + ισχυρή τάση προγράμματος",
  ),
  special(
    "17675",
    "Ειδικός κανόνας 17675",
    ["17121", "17122"],
    ["1185x", "1174x"],
    ["17341"],
    "Νεότερος κανόνας: καμία αυτόματη σύνδεση με τον 17341.",
  ),
  special(
    "18233",
    "Ειδικός κανόνας 18233",
    ["18542", "18541", "18547"],
    [],
    [],
    "Ρητά επιβεβαιωμένη τριάδα αντιστοίχισης.",
  ),
  special(
    "18541",
    "Ειδικός κανόνας 18541",
    ["1812x", "1834x", "1845x"],
    [],
    [],
    "Ρητά επιβεβαιωμένη σύνδεση με τις τρεις οικογένειες.",
  ),
  special(
    "18543",
    "Ειδικός κανόνας 18543",
    ["18121", "18452", "18542", "18541", "18120"],
    [],
    [],
    "Το 18452 εμφανίζεται μία φορά στη λίστα αποτελεσμάτων.",
  ),
  trendSpecial(
    "18544",
    "18544 • Ομάδα 181 / 182 / 184 / 185",
    ["18541", "18542", "18543", "18233", "18452", "18120"],
    ["18454", "18547"],
    [],
    "Και οι 8 αναθέσεις του 18544 εμφανίζονται με μέλη της καθιερωμένης ομάδας 181 / 182 / 184 / 185. Οι 18454 και 18547 παραμένουν εναλλακτικές λόγω μικρότερου δείγματος.",
  ),
  trendSpecial(
    "19014",
    "19014 / 19015 • Ισχυρή επαναλαμβανόμενη δυάδα",
    ["19015"],
    ["19013", "19010", "19001"],
    [],
    "Ο 19014 εμφανίζεται μαζί με τον 19015 σε 33 από τις 36 αναθέσεις του. Οι 19013, 19010 και 19001 παραμένουν δευτερεύουσες τάσεις.",
  ),
  trendSpecial(
    "19015",
    "19014 / 19015 • Ισχυρή επαναλαμβανόμενη δυάδα",
    ["19014"],
    ["19013", "19010", "19001"],
    [],
    "Οι 19014 και 19015 εμφανίζονται μαζί σε 33 κοινές αναθέσεις. Οι 19013, 19010 και 19001 παραμένουν δευτερεύουσες τάσεις.",
  ),
  special(
    "19003",
    "Ειδικός κανόνας 19003",
    ["19001", "19400", "19441", "19010"],
    [],
    ["19016", "19009", "19004", "19005"],
    "Νεότερος ειδικός κανόνας· ο 19003 δεν ανήκει στην ομάδα 153xx / 190xx.",
  ),
  special(
    "19500",
    "Απομονωμένος ΤΚ 19500",
    [],
    ["Οποιοσδήποτε ΤΚ μόνο σε ανάγκη"],
    ["Κανονικό ταίριασμα με άλλη ομάδα"],
    "Στο χειρόγραφο αναφέρεται ως απομονωμένος ΤΚ· συνδυασμός μόνο όταν δεν υπάρχει άλλη λύση.",
    "Χειρόγραφος κανόνας",
  ),
];

const specialByPostcode = new Map(specialRules.map((rule) => [rule.postcode, rule]));

const group104 = expand("104", 41, 46);
const group111 = expand("111", 41, 47);
const group116 = ["11633", "11634", "16121", "16122", "16231", "16232", "17237"];
const group141 = [
  ...expand("141", 21, 23),
  ...expand("142", 31, 35),
  ...expand("143", 41, 43),
  ...expand("144", 51, 52),
];
const group145A = ["14561", "14562", "14569", "14571", "14572"];
const group145B = [
  ...expand("145", 63, 65),
  "14568",
  ...expand("145", 74, 76),
  "14578",
  "14671",
];
const group151A = ["15121", "15122"];
const group151B = expand("151", 23, 26);
const group151C = ["15127", ...expand("152", 35, 39)];
const group152 = expand("152", 31, 34);
const group153to156 = [
  ...expand("153", 41, 43),
  "15451", "15452", "15561", "15562", "15661", "15662", "15669",
];
const group153to190 = [
  "15344", "15351", "15354", "19002", "19004", "19005", "19007", "19009", "19016",
];
const group118A = ["11854", "11856", "17778", "11742", "10436"];
const group171B = ["17121", "17122", "17124"];
const group19003 = ["19001", "19003", "19010", "19400", "19441"];

const subgroup = (
  own: string[],
  alternatives: string[],
  group: string,
  note: string,
  confidence = "Χειρόγραφος κανόνας",
): GroupRule => ({
  matches: exactSet(own),
  resolve: (postcode) => confirmed({
    group,
    direct: without(own, postcode),
    indirect: alternatives,
    excluded: [],
    note,
    confidence,
  }),
});

const groupRules: GroupRule[] = [
  ...[group104, group111].map((members): GroupRule => ({
    matches: exactSet(members),
    resolve: (postcode) => {
      const direct = without(members, postcode);
      if (postcode.startsWith("104")) direct.push("11255", "11256", "11257");
      if (postcode.startsWith("111")) direct.push("11255", "11256", "11257", "11364");
      return confirmed({
        group: postcode.startsWith("104") ? "Ομάδα 10441–10446" : "Ομάδα 11141–11147",
        direct: unique(direct),
        indirect: [],
        excluded: ["10447", "115xx"],
        note: "Ο 10447 έχει ξεχωριστό ειδικό κανόνα. Τα 115xx έχουν αφαιρεθεί πλήρως. Οι 11255–11257 και 11364 εφαρμόζονται μόνο σύμφωνα με τους ειδικούς κανόνες τους.",
        confidence: "Επιβεβαιωμένη ομάδα",
      });
    },
  })),
  {
    matches: (postcode) => postcode.startsWith("106") || postcode.startsWith("114"),
    resolve: () => confirmed({
      group: "Ομάδα 106xx / 114xx",
      direct: ["106xx", "114xx"],
      indirect: [],
      excluded: [],
      note: "Και οι δύο οικογένειες εξυπηρετούνται κατά προτίμηση από τον τεχνικό ΜΠΑΡΟΥΝΗ ΒΑΓΓΕΛΗ.",
      confidence: "Επιβεβαιωμένη ομάδα",
    }),
  },
  {
    matches: (postcode) => postcode.startsWith("115") || postcode.startsWith("157"),
    resolve: () => confirmed({
      group: "Ομάδα 115xx / 157xx",
      direct: ["115xx", "157xx"],
      indirect: [],
      excluded: ["104xx", "111xx", "116xx"],
      note: "Νεότερος ρητός κανόνας: όλα τα 115xx μεταφέρθηκαν στα 157xx και παραμένουν διαφορετικά από τα 116xx.",
      confidence: "Ρητός νεότερος κανόνας",
    }),
  },
  {
    matches: exactSet(group116),
    resolve: (postcode) => confirmed({
      group: "Ομάδα 116 / 161 / 162 / 172",
      direct: without(group116, postcode),
      indirect: [],
      excluded: ["115xx"],
      note: "Βασική ομάδα του χειρόγραφου οδηγού. Ο 11635 έχει ξεχωριστό ειδικό κανόνα.",
      confidence: "Επιβεβαιωμένη ομάδα",
    }),
  },
  {
    matches: exactSet(group141),
    resolve: (postcode) => confirmed({
      group: "Ομάδα 141 / 142 / 143 / 144",
      direct: without(group141, postcode),
      indirect: [],
      excluded: [],
      note: "Οι 14232–14235 και 14343 επιβεβαιώνονται από ισχυρή τάση του προγράμματος.",
      confidence: "Χειρόγραφο + ισχυρή τάση",
    }),
  },
  subgroup(
    group145A,
    group145B,
    "145 — υποομάδα Α",
    "Πρώτη επιλογή η ίδια υποομάδα· η υποομάδα Β χρησιμοποιείται όταν δεν υπάρχει διαθέσιμη επιλογή.",
    "Επιβεβαιωμένη υποομάδα",
  ),
  subgroup(
    group145B,
    group145A,
    "145 — υποομάδα Β",
    "Πρώτη επιλογή η ίδια υποομάδα. Ο 14576 εμφανίζεται λειτουργικά και με τις δύο υποομάδες.",
    "Χειρόγραφο + ισχυρή τάση",
  ),
  subgroup(
    group151A,
    [...group151B, ...group151C],
    "151 / 152 — υποομάδα Α",
    "Χρησιμοποιείται πρώτα η ίδια υποομάδα και μετά οι άλλες δύο ως εναλλακτικές.",
  ),
  subgroup(
    group151B,
    [...group151A, ...group151C],
    "151 / 152 — υποομάδα Β",
    "Χρησιμοποιείται πρώτα η ίδια υποομάδα και μετά οι άλλες δύο ως εναλλακτικές.",
  ),
  subgroup(
    group151C,
    [...group151A, ...group151B],
    "151 / 152 — υποομάδα Γ",
    "Χρησιμοποιείται πρώτα η ίδια υποομάδα και μετά οι άλλες δύο ως εναλλακτικές.",
  ),
  subgroup(
    group152,
    [],
    "Αυτόνομη ομάδα 15231–15234",
    "Αυτόνομη βασική ομάδα του αρχικού χειρόγραφου.",
  ),
  subgroup(
    group153to156,
    [],
    "Ομάδα 153 / 154 / 155 / 156",
    "Ο 15561 έχει ισχυρή επιβεβαίωση από το πρόγραμμα· οι 15342/15343 έχουν μικρότερο αλλά συνεπές δείγμα.",
    "Κανόνας + τάση προγράμματος",
  ),
  {
    matches: exactSet(group153to190),
    resolve: (postcode) => {
      const direct = without(group153to190, postcode);
      if (["15344", "15351", "15354"].includes(postcode)) direct.push("15349");
      return confirmed({
        group: "Ομάδα 153xx / 190xx",
        direct: unique(direct),
        indirect: [],
        excluded: ["19003"],
        note: "Ο 19003 παραμένει εκτός λόγω νεότερου ειδικού κανόνα. Ο 19007 επιβεβαιώνεται από ισχυρή τάση προγράμματος.",
        confidence: "Επιβεβαιωμένη ομάδα + τάση",
      });
    },
  },
  subgroup(
    group118A,
    group171B,
    "Ομάδα 118 / 117 / 177 / 104",
    "Πρώτα χρησιμοποιούνται τα μέλη της ίδιας εσωτερικής ομάδας και μετά οι 1712x ως εναλλακτική.",
  ),
  subgroup(
    group171B,
    group118A,
    "Ομάδα 1712x",
    "Πρώτα χρησιμοποιούνται τα μέλη της ίδιας εσωτερικής ομάδας και μετά η ομάδα 118/117/177/104 ως εναλλακτική.",
  ),
  {
    matches: exactSet(group19003),
    resolve: (postcode) => confirmed({
      group: "Ομάδα 19001 / 19003 / 19010 / 194xx",
      direct: without(group19003, postcode),
      indirect: [],
      excluded: postcode === "19003" ? ["19004", "19005", "19009", "19016"] : [],
      note: "Ο ειδικός κανόνας του 19003 υπερισχύει όλων των γενικών αντιστοιχίσεων.",
      confidence: "Επιβεβαιωμένη ομάδα",
    }),
  },
];

const trendRules: Record<string, { indirect: string[]; note: string }> = {
  ...Object.fromEntries(
    ["10553", "10554", "10555", "10556", "10557", "10558", "10562", "10563"].map((postcode) => [
      postcode,
      { indirect: ["10441–10446", "11141–11147"], note: "περιορισμένη τάση 105xx" },
    ]),
  ),
  ...Object.fromEntries(
    ["11252", "11253", "11254", "11363"].map((postcode) => [
      postcode,
      { indirect: ["10441–10446", "11141–11147"], note: "ισχυρή τάση προγράμματος" },
    ]),
  ),
  "11636": { indirect: group116, note: "ισχυρή τάση προγράμματος" },
  "16233": { indirect: group116, note: "ισχυρή τάση προγράμματος" },
  "17123": { indirect: group171B, note: "ισχυρή τάση προγράμματος" },
};

type ProgramPair = readonly [string, string];

// Επαναλαμβανόμενα ζεύγη από τα δρομολόγια Ιουλίου–Σεπτεμβρίου 2026.
// Παραμένουν τάσεις προγράμματος και δεν υπερισχύουν ποτέ ρητής εξαίρεσης.
const strongProgramPairs: ProgramPair[] = [
  ["13122", "13123"],
  ["12461", "12462"],
  ["13123", "13231"],
  ["13121", "13123"],
  ["11254", "11255"],
  ["13123", "13451"],
  ["12243", "12461"],
  ["11741", "11743"],
  ["11741", "11745"],
  ["18541", "18547"],
  ["11253", "11255"],
];

const supportingProgramPairs: ProgramPair[] = [
  ["12242", "12243"],
  ["12242", "12461"],
  ["12242", "12462"],
  ["12243", "12462"],
  ["11741", "11742"],
  ["11742", "11743"],
  ["11742", "11745"],
  ["11743", "11745"],
  ["11252", "11255"],
  ["11255", "11256"],
  ["11255", "11257"],
  ["11851", "11852"],
  ["11851", "11853"],
  ["11853", "17778"],
  ["13231", "13232"],
  ["18120", "18547"],
  ["18452", "18547"],
  ["18120", "18122"],
  ["18452", "18454"],
  ["18453", "18543"],
  ["18453", "18547"],
  ["13671", "13676"],
  ["13671", "13679"],
  ["13676", "13679"],
  ["15231", "15237"],
  ["15234", "15237"],
];

const linkedPostcodes = (postcode: string, pairs: ProgramPair[]) =>
  pairs.flatMap(([first, second]) =>
    first === postcode ? [second] : second === postcode ? [first] : [],
  );

const unknownResult = (postcode: string): SearchResult => ({
  postcode,
  group: "Χωρίς καταγεγραμμένο κανόνα",
  direct: [],
  indirect: [],
  excluded: [],
  note: "Η απουσία κανόνα δεν σημαίνει βεβαιωμένη ασυμβατότητα. Απλώς δεν υπάρχει επαρκές ή ρητά επιβεβαιωμένο στοιχείο.",
  confidence: "Χρειάζεται επιβεβαίωση",
  status: "unknown",
});

export function resolvePostcode(postcode: string): SearchResult {
  if (!/^1\d{4}$/.test(postcode)) return unknownResult(postcode);

  const exactSpecial = specialByPostcode.get(postcode);
  const base = exactSpecial ?? groupRules.find((rule) => rule.matches(postcode))?.resolve(postcode);
  let direct = base?.direct ? [...base.direct] : [];
  let indirect = base?.indirect ? [...base.indirect] : [];
  let excluded = base?.excluded ? [...base.excluded] : [];
  const inverseNotes: string[] = [];

  if (!exactSpecial?.exclusive) {
    for (const rule of specialRules) {
      if (rule.postcode === postcode) continue;
      if (rule.direct.some((candidate) => patternMatches(postcode, candidate))) {
        direct.push(rule.postcode);
        inverseNotes.push(`συνδέεται με τον ειδικό ${rule.postcode}`);
      }
      if (rule.indirect.some((candidate) => patternMatches(postcode, candidate))) {
        indirect.push(rule.postcode);
        inverseNotes.push(`εναλλακτικά με τον ειδικό ${rule.postcode}`);
      }
      if (rule.excluded.some((candidate) => patternMatches(postcode, candidate))) {
        excluded.push(rule.postcode);
      }
    }
  }

  const trend = trendRules[postcode];
  if (trend) indirect.push(...trend.indirect);

  const programDirect = exactSpecial?.exclusive ? [] : linkedPostcodes(postcode, strongProgramPairs);
  const programIndirect = exactSpecial?.exclusive ? [] : linkedPostcodes(postcode, supportingProgramPairs);
  direct.push(...programDirect);
  indirect.push(...programIndirect);

  excluded = unique(without(excluded, postcode));
  const isExplicitlyExcluded = (candidate: string) =>
    excluded.some((pattern) => patternMatches(candidate, pattern));
  direct = unique(without(direct, postcode)).filter((value) => !isExplicitlyExcluded(value));
  indirect = unique(without(indirect, postcode)).filter(
    (value) => !direct.includes(value) && !isExplicitlyExcluded(value),
  );

  if (!base && !direct.length && !indirect.length && !excluded.length) return enforcePostcodeFamilySeparation(unknownResult(postcode));

  const notes = [base?.note];
  if (!base && inverseNotes.length) {
    notes.push(`Αντίστροφη εφαρμογή ειδικού κανόνα: ${unique(inverseNotes).join(" · ")}.`);
  }
  if (trend) {
    notes.push(`Η πρόσθετη αντιστοίχιση εμφανίζεται ως ${trend.note}, όχι ως ρητός εταιρικός κανόνας.`);
  }
  const appliedProgramDirect = programDirect.filter((value) => direct.includes(value));
  const appliedProgramIndirect = programIndirect.filter((value) => indirect.includes(value));
  if (appliedProgramDirect.length) {
    notes.push(`Ισχυρές τάσεις από επαναλαμβανόμενα δρομολόγια Ιουλίου–Σεπτεμβρίου 2026: ${appliedProgramDirect.join(", ")}.`);
  }
  if (appliedProgramIndirect.length) {
    notes.push(`Πρόσθετες έμμεσες τάσεις από τα ίδια spreadsheets: ${appliedProgramIndirect.join(", ")}.`);
  }
  if (appliedProgramDirect.length || appliedProgramIndirect.length) {
    notes.push("Οι τάσεις προγράμματος δεν υπερισχύουν των ρητών εξαιρέσεων.");
  }

  const hasProgramTrend = appliedProgramDirect.length > 0 || appliedProgramIndirect.length > 0;

  return enforcePostcodeFamilySeparation({
    postcode,
    group: base?.group ?? (hasProgramTrend ? "Τάσεις δρομολογίων Ιουλίου–Σεπτεμβρίου 2026" : trend ? "Τάση προγράμματος" : "Σχετικός ειδικός κανόνας"),
    direct,
    indirect,
    excluded,
    note: notes.filter(Boolean).join(" "),
    confidence: base?.confidence ?? (hasProgramTrend ? "Ισχυρή τάση 3 μηνών" : trend ? "Τάση προγράμματος" : "Ειδικός συσχετισμός"),
    status: base?.status ?? "trend",
  });
}
