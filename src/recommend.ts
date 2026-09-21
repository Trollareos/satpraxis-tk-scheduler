import { enforcePostcodeFamilySeparation, isProhibitedPostcodePair, resolvePostcode, type SearchResult } from "./tk-data";
import {
  canonicalTechnicianName,
  normalizeGreek,
  type ParsedSchedule,
  type ScheduleJob,
  type TechnicianDay,
} from "./xlsx";

export type CandidateMatch = "special" | "exact" | "direct" | "indirect" | "history" | "empty";

export type HistoricalCounts = {
  generatedThrough: string;
  exact: Record<string, Record<string, number>>;
  prefix3: Record<string, Record<string, number>>;
};

export type Candidate = {
  technician: TechnicianDay;
  eligible: boolean;
  score: number;
  reasons: string[];
  warnings: string[];
  blockers: string[];
  activationCount: number;
  otherCount: number;
  match: CandidateMatch;
};

export type Recommendation = {
  postcode: string;
  rule: SearchResult;
  candidates: Candidate[];
  rejected: Candidate[];
};

const MANUAL_TRENDS: Record<string, string[]> = {
  "19441": ["ΜΑΥΡΟΓΙΑΝΝΗΣ ΣΤΑΜΑΤΗΣ"],
  "18543": ["ΣΟΜΠΑΣ ΑΡΗΣ", "ΚΛΗΡΟΝΟΜΟΣ ΑΛΕΞΗΣ"],
  "12243": ["ΕΥΘΥΜΙΟΥ ΙΩΑΝΝΗΣ", "ΛΕΙΒΑΔΙΤΗΣ ΧΡΙΣΤΟΦΟΡΟΣ"],
  "15341": ["ΜΟΡΟΖΟΒ ΚΩΣΤΑΣ", "ΜΟΥΤΟΣ ΔΙΟΝΥΣΙΟΣ", "ΣΥΡΙΟΠΟΥΛΟΣ ΧΡΙΣΤΟΦΟΡΟΣ"],
};

export function patternMatches(postcode: string, rawPattern: string): boolean {
  const pattern = String(rawPattern || "").trim().replace(/[XΧχ]/g, "x").replace(/[–—]/g, "-");
  if (/^1\d{4}$/.test(pattern)) return postcode === pattern;
  if (/^1[\dx]{4}$/.test(pattern)) {
    return new RegExp("^" + pattern.replace(/x/g, "\\d") + "$").test(postcode);
  }
  const fullRange = pattern.match(/^(1\d{4})-(1\d{4})$/);
  if (fullRange) return Number(postcode) >= Number(fullRange[1]) && Number(postcode) <= Number(fullRange[2]);
  const shortRange = pattern.match(/^(1\d{2})(\d{2})-(\d{2})$/);
  if (shortRange && postcode.startsWith(shortRange[1])) {
    const suffix = Number(postcode.slice(3));
    return suffix >= Number(shortRange[2]) && suffix <= Number(shortRange[3]);
  }
  return false;
}

function isActivation(job: ScheduleJob): boolean {
  return normalizeGreek(job.type).includes("FTTH ACTIVATION");
}

function isNova(job: ScheduleJob): boolean {
  return job.provider === "nova";
}

function isVodafone(job: ScheduleJob): boolean {
  return job.provider === "vodafone";
}

function isHorizontal(job: ScheduleJob): boolean {
  return normalizeGreek(job.type).includes("HORIZONTAL");
}

function headerRules(name: string): { blockers: string[]; warnings: string[] } {
  const normalized = normalizeGreek(name);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (/(?:^|\s)(?:ΕΚΤΟΣ|EKTOS|ΑΔΕΙΑ)(?:\s|$)/u.test(normalized) || /ΟΧΙ\s+ΑΛΛ(?:Ο|Α)/u.test(normalized)) {
    blockers.push("Ο τεχνικός σημειώνεται ως μη διαθέσιμος στο σημερινό φύλλο.");
  }
  const cutoff = normalized.match(/(?:ΜΕΧΡΙ|ΕΩΣ)\s*(\d{1,2})(?::|[.,])?(\d{2})?/u);
  if (cutoff) {
    warnings.push("Ο τεχνικός έχει όριο ώρας " + cutoff[1].padStart(2, "0") + ":" + String(cutoff[2] || "00").padStart(2, "0") + "· επίλεξε χειροκίνητα ώρα πριν από αυτό.");
  }
  if (normalized.includes("ΝΑ ΜΗΝ ΑΛΛΑΞΕΙ")) {
    warnings.push("ΝΑ ΜΗΝ ΑΛΛΑΞΕΙ: επιτρέπεται μόνο προσθήκη στο πραγματικά κενό slot.");
  }
  const operationalText = /\d|\(|\)|\+|ΜΕΧΡΙ|ΕΩΣ|ΟΧΙ|ΑΔΕΙΑ|ΕΚΤΟΣ|EKTOS|ΑΛΛΑΞΕΙ/u.test(normalized);
  if (operationalText && !blockers.length && !warnings.length) {
    warnings.push("Υπάρχει πρόσθετη σημείωση δίπλα στο όνομα· χρειάζεται οπτικός έλεγχος πριν την καταχώριση.");
  }
  return { blockers, warnings };
}

function historyCount(history: HistoricalCounts, technician: string, postcode: string): { exact: number; prefix: number } {
  const canonical = canonicalTechnicianName(technician);
  const similar = (candidate: string): boolean => {
    if (candidate === canonical || candidate.startsWith(canonical + " ") || canonical.startsWith(candidate + " ")) return true;
    const first = new Set(candidate.split(" ").filter((token) => token.length >= 4));
    const second = canonical.split(" ").filter((token) => token.length >= 4);
    const overlap = second.filter((token) => first.has(token)).length;
    return overlap >= 2 || (overlap === 1 && (first.size === 1 || second.length === 1));
  };
  const sumSimilar = (values: Record<string, number> | undefined): number =>
    Object.entries(values || {}).reduce((total, [name, count]) => total + (similar(name) ? count : 0), 0);
  return {
    exact: sumSimilar(history.exact[postcode]),
    prefix: sumSimilar(history.prefix3[postcode.slice(0, 3)]),
  };
}

function scoreRoute(
  candidate: Candidate,
  postcode: string,
  rule: SearchResult,
  jobs: ScheduleJob[],
): void {
  const routed = jobs.filter((job) => job.postcode);
  const prohibited = routed.filter((job) => job.postcode && isProhibitedPostcodePair(postcode, job.postcode));
  if (prohibited.length) {
    candidate.blockers.push("Νέα οδηγία 06/09/2026: τα 104xx και 111xx δεν συνδυάζονται. Υπάρχει στο δρομολόγιο ο ασύμβατος ΤΚ " + [...new Set(prohibited.map((job) => job.postcode))].join(", ") + ".");
    return;
  }
  const exact = routed.filter((job) => job.postcode === postcode);
  const direct = routed.filter((job) => job.postcode && rule.direct.some((pattern) => patternMatches(job.postcode!, pattern)));
  const indirect = routed.filter((job) => job.postcode && rule.indirect.some((pattern) => patternMatches(job.postcode!, pattern)));
  const excluded = routed.filter((job) => job.postcode && rule.excluded.some((pattern) => patternMatches(job.postcode!, pattern)));
  const incompatible = routed.filter((job) => job.postcode &&
    job.postcode !== postcode &&
    !rule.direct.some((pattern) => patternMatches(job.postcode!, pattern)) &&
    !rule.indirect.some((pattern) => patternMatches(job.postcode!, pattern)) &&
    !rule.excluded.some((pattern) => patternMatches(job.postcode!, pattern)));
  if (exact.length) {
    candidate.match = "exact";
    candidate.score += 220;
    candidate.reasons.push("Έχει ήδη τον ίδιο ΤΚ την επιλεγμένη ημέρα (" + postcode + ").");
    const outsideKnownRule = [...new Set([...excluded, ...incompatible].map((job) => job.postcode).filter(Boolean))];
    if (outsideKnownRule.length) {
      candidate.warnings.push("Υπάρχουν και άλλοι ΤΚ στο δρομολόγιο εκτός του γνωστού κανόνα (" + outsideKnownRule.join(", ") + "), αλλά δεν αποκλείστηκε επειδή έχει ήδη τον ζητούμενο ΤΚ.");
    }
    return;
  }
  if (excluded.length) {
    candidate.blockers.push("Υπάρχει στο ίδιο δρομολόγιο ρητά ασύμβατος ΤΚ: " + [...new Set(excluded.map((job) => job.postcode))].join(", ") + ".");
  }
  if (incompatible.length) {
    candidate.blockers.push("Το δρομολόγιο της επιλεγμένης ημέρας έχει ΤΚ εκτός της ομάδας " + postcode + ": " + [...new Set(incompatible.map((job) => job.postcode))].join(", ") + ".");
  }
  if (direct.length) {
    candidate.match = "direct";
    candidate.score += 135;
    candidate.reasons.push("Έχει άμεσα συμβατό ΤΚ την επιλεγμένη ημέρα: " + [...new Set(direct.map((job) => job.postcode))].join(", ") + ".");
  } else if (indirect.length) {
    candidate.match = "indirect";
    candidate.score += 75;
    candidate.reasons.push("Έχει έμμεσα συμβατό ΤΚ την επιλεγμένη ημέρα: " + [...new Set(indirect.map((job) => job.postcode))].join(", ") + ".");
  }
}

function evaluateTechnician(
  technician: TechnicianDay,
  postcode: string,
  rule: SearchResult,
  history: HistoricalCounts,
): Candidate {
  const jobs = technician.jobs;
  const activationJobs = jobs.filter(isActivation);
  const otherJobs = jobs.filter((job) => !isActivation(job));
  const novaJobs = jobs.filter(isNova);
  const vodafoneJobs = jobs.filter(isVodafone);
  const unknownProviderJobs = jobs.filter((job) => job.provider === "unknown");
  const horizontalJobs = jobs.filter(isHorizontal);
  const candidate: Candidate = {
    technician,
    eligible: true,
    score: 0,
    reasons: [],
    warnings: [],
    blockers: [],
    activationCount: activationJobs.length,
    otherCount: otherJobs.length,
    match: "empty",
  };

  const header = headerRules(technician.name);
  candidate.blockers.push(...header.blockers);
  candidate.warnings.push(...header.warnings);

  if (activationJobs.length >= 4) {
    candidate.warnings.push("Έχει ήδη 4 FTTH Activation· έλεγξε χειροκίνητα αν χωράει η νέα εργασία.");
  }
  if (otherJobs.length >= 6) {
    candidate.warnings.push("Έχει ήδη 6 λοιπές εργασίες· έλεγξε χειροκίνητα αν χωράει η νέα εργασία.");
  }

  if (jobs.length && !novaJobs.length) {
    if (vodafoneJobs.length) {
      candidate.blockers.push("Έχει αναθέσεις Vodafone αλλά καμία επιβεβαιωμένη NOVA (PS/TAS) στο συγκεκριμένο φύλλο.");
    } else {
      candidate.blockers.push("Έχει αναθέσεις χωρίς επιβεβαιωμένο κωδικό NOVA PS/TAS στο συγκεκριμένο φύλλο.");
    }
  } else if (unknownProviderJobs.length) {
    candidate.warnings.push("Υπάρχει εργασία με κενό ή άγνωστο κωδικό παρόχου· χρειάζεται οπτικός έλεγχος.");
  }
  if (horizontalJobs.length) {
    if (!novaJobs.length) {
      // The previous blocker already explains the exclusion.
    } else if (horizontalJobs.some((job) => !job.green)) {
      candidate.blockers.push("Υπάρχει Horizontal Construction χωρίς ένδειξη πράσινης συνδυαστικής/ειδικής κατασκευής.");
    } else {
      candidate.warnings.push("Υπάρχει NOVA μαζί με πράσινη συνδυαστική/ειδική Horizontal Construction.");
    }
  }

  scoreRoute(candidate, postcode, rule, jobs);

  if ((postcode.startsWith("106") || postcode.startsWith("114")) && technician.canonicalName.includes("ΜΠΑΡΟΥΝΗΣ ΒΑΓΓΕΛΗΣ")) {
    candidate.match = "special";
    candidate.score += 500;
    candidate.reasons.unshift("Ρητός κανόνας: τα 106xx / 114xx προτιμούν τον ΜΠΑΡΟΥΝΗ ΒΑΓΓΕΛΗ.");
  }

  const historical = historyCount(history, technician.name, postcode);
  if (historical.exact) {
    if (candidate.match === "empty") candidate.match = "history";
    candidate.score += Math.min(72, historical.exact * 9);
    candidate.reasons.push("Ιστορικό: " + historical.exact + " προηγούμενες εργασίες στον ίδιο ΤΚ.");
  } else if (historical.prefix) {
    if (candidate.match === "empty") candidate.match = "history";
    candidate.score += Math.min(28, historical.prefix * 2);
    candidate.reasons.push("Ιστορική τάση στην οικογένεια " + postcode.slice(0, 3) + "xx.");
  }
  const manualTrend = MANUAL_TRENDS[postcode] || [];
  if (manualTrend.some((name) => technician.canonicalName.includes(canonicalTechnicianName(name)))) {
    if (candidate.match === "empty") candidate.match = "history";
    candidate.score += 32;
    candidate.reasons.push("Καταγεγραμμένη ιστορική τάση Ιουλίου για τον συγκεκριμένο ΤΚ.");
  }

  if (!jobs.length) {
    candidate.score += 4;
    candidate.reasons.push("Ο τεχνικός είναι κενός και μπορεί να ξεκινήσει δρομολόγιο NOVA.");
  }
  candidate.score += Math.max(0, 10 - jobs.length);
  candidate.eligible = candidate.blockers.length === 0;
  if (!candidate.reasons.length) candidate.reasons.push("Δεν υπάρχει ισχυρό γεωγραφικό στοιχείο· χρησιμοποίησέ τον μόνο μετά από χειροκίνητο έλεγχο.");
  return candidate;
}

function matchPriority(match: CandidateMatch): number {
  return { special: 0, exact: 1, direct: 2, indirect: 3, history: 4, empty: 5 }[match];
}

export function recommendTechnicians(
  schedule: ParsedSchedule,
  postcode: string,
  history: HistoricalCounts,
  resolver: (postcode: string) => SearchResult = resolvePostcode,
): Recommendation {
  const rule = enforcePostcodeFamilySeparation(resolver(postcode));
  const evaluated = schedule.technicians
    .filter((technician) => technician.red)
    .map((technician) => evaluateTechnician(technician, postcode, rule, history));
  const candidates = evaluated
    .filter((candidate) => candidate.eligible)
    .sort((first, second) => matchPriority(first.match) - matchPriority(second.match) || second.score - first.score || first.technician.canonicalName.localeCompare(second.technician.canonicalName, "el"));
  const rejected = evaluated
    .filter((candidate) => !candidate.eligible)
    .sort((first, second) => second.score - first.score);
  return { postcode, rule, candidates, rejected };
}
