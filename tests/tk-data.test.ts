import assert from "node:assert/strict";
import test from "node:test";
import { enforcePostcodeFamilySeparation, isProhibitedPostcodePair, resolvePostcode } from "../src/tk-data.ts";

test("every 104xx and 111xx postcode excludes the other family", () => {
  for (const [prefix, blocked] of [["104", "111"], ["111", "104"]]) {
    for (let suffix = 0; suffix < 100; suffix++) {
      const postcode = prefix + String(suffix).padStart(2, "0");
      const result = resolvePostcode(postcode);
      assert(result.excluded.includes(`${blocked}xx`), postcode);
      assert([...result.direct, ...result.indirect].every((value) => !value.startsWith(blocked)), postcode);
      assert(isProhibitedPostcodePair(postcode, `${blocked}41`), postcode);
    }
  }
});

test("splitting the families preserves their own members and individual 112xx links", () => {
  for (const [first, second] of [["10441", "10446"], ["11141", "11147"]]) {
    const result = resolvePostcode(first);
    assert(result.direct.includes(second));
    assert(result.direct.includes("11255"));
    assert.equal(isProhibitedPostcodePair(first, second), false);
    assert.equal(result.group.includes(" / "), false);
  }
  assert(resolvePostcode("11255").direct.includes("104xx"));
  assert(resolvePostcode("11255").direct.includes("111xx"));
});

test("older local rules cannot restore excluded exact, wildcard or range suggestions", () => {
  for (const [postcode, blocked] of [["10441", "111"], ["11141", "104"]]) {
    const stalePatterns = [`${blocked}41`, `${blocked}xx`, `${blocked}XX`, `${blocked}χχ`, `${blocked}41–47`, `${blocked}41-${blocked}47`];
    const result = enforcePostcodeFamilySeparation({
      ...resolvePostcode(postcode),
      direct: [...stalePatterns, "11255"],
      indirect: [...stalePatterns, "11253"],
      excluded: [],
      note: "Παλαιότερη τοπική ενημέρωση.",
    });
    assert.deepEqual(result.direct, ["11255"]);
    assert.deepEqual(result.indirect, ["11253"]);
    assert.deepEqual(result.excluded, [`${blocked}xx`]);
    assert.match(result.note, /06\/09\/2026/);
    assert.deepEqual(enforcePostcodeFamilySeparation(result), result);
  }
});

test("10447 uses only its new exclusive postcode families", () => {
  const result = resolvePostcode("10447");

  assert.equal(result.group, "Ειδικός κανόνας 10447");
  assert.deepEqual(result.direct, ["118xx", "117xx", "177xx", "178xx"]);
  assert.deepEqual(result.indirect, []);
  assert.deepEqual(result.excluded, ["104xx", "111xx"]);
});

test("both separate 104 and 111 groups exclude 10447", () => {
  for (const postcode of ["10441", "10446", "11141", "11147"]) {
    const result = resolvePostcode(postcode);
    assert.equal(result.direct.includes("10447"), false, postcode);
    assert.equal(result.excluded.includes("10447"), true, postcode);
  }
});

test("the new 10447 relationship is reciprocal for its four families", () => {
  for (const postcode of ["11854", "11741", "17778", "17835"]) {
    assert.equal(resolvePostcode(postcode).direct.includes("10447"), true, postcode);
  }
});

test("strong three-month route trends are reciprocal direct matches", () => {
  const pairs = [
    ["13122", "13123"],
    ["12461", "12462"],
    ["13123", "13231"],
    ["11254", "11255"],
    ["11741", "11743"],
    ["18541", "18547"],
  ] as const;

  for (const [first, second] of pairs) {
    assert.equal(resolvePostcode(first).direct.includes(second), true, `${first} → ${second}`);
    assert.equal(resolvePostcode(second).direct.includes(first), true, `${second} → ${first}`);
  }
});

test("supporting route trends are reciprocal indirect matches", () => {
  const pairs = [
    ["12242", "12461"],
    ["11742", "11745"],
    ["11255", "11256"],
    ["11851", "11853"],
    ["18120", "18547"],
    ["13671", "13676"],
    ["15231", "15237"],
  ] as const;

  for (const [first, second] of pairs) {
    assert.equal(resolvePostcode(first).indirect.includes(second), true, `${first} → ${second}`);
    assert.equal(resolvePostcode(second).indirect.includes(first), true, `${second} → ${first}`);
  }
});

test("explicit exclusions remain reciprocal and override route trends", () => {
  const pairs = [
    ["13121", "13122"],
    ["10435", "11256"],
    ["19003", "19016"],
  ] as const;

  for (const [first, second] of pairs) {
    const firstResult = resolvePostcode(first);
    const secondResult = resolvePostcode(second);
    assert.equal(firstResult.excluded.includes(second), true, `${first} excludes ${second}`);
    assert.equal(secondResult.excluded.includes(first), true, `${second} excludes ${first}`);
    assert.equal(firstResult.direct.includes(second), false, `${first} must not directly match ${second}`);
    assert.equal(secondResult.direct.includes(first), false, `${second} must not directly match ${first}`);
  }
});
