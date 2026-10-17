/**
 * Настройки публикации и выбор обложки.
 * Запуск: npm test
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  SETTINGS,
  defaultSettings,
  fieldVisible,
  hasSettings,
  resolveSettings,
} from "../src/lib/publish-settings.ts";
import { candidateTimestamps, clampCoverMs, formatTimecode } from "../src/lib/cover.ts";

describe("Настройки публикации", () => {
  it("YouTube по умолчанию публикуется сразу всем", () => {
    assert.equal(defaultSettings("YOUTUBE").privacy, "public");
  });

  it("у каждого поля есть значение по умолчанию", () => {
    for (const provider of ["YOUTUBE", "INSTAGRAM", "TIKTOK"] as const) {
      for (const group of SETTINGS[provider]) {
        for (const f of group.fields) {
          assert.notEqual(f.default, undefined, `${provider}.${f.key}`);
          if (f.type === "select") {
            const values = (f.options ?? []).map((o) => o.value);
            assert.ok(values.includes(String(f.default)), `${provider}.${f.key}: умолчание вне списка`);
          }
        }
      }
    }
  });

  it("зависимые поля прячутся", () => {
    const notify = SETTINGS.YOUTUBE.flatMap((g) => g.fields).find((f) => f.key === "notifySubscribers")!;
    assert.equal(fieldVisible(notify, { privacy: "unlisted" }), false);
    assert.equal(fieldVisible(notify, { privacy: "public" }), true);
  });

  it("чужие и испорченные значения отбрасываются", () => {
    const r = resolveSettings("YOUTUBE", { privacy: "public", чужое: 1, madeForKids: "да" });
    assert.equal(r.privacy, "public");
    assert.equal(r.madeForKids, false); // строка вместо флага — берём умолчание
    assert.equal((r as Record<string, unknown>).чужое, undefined);
  });

  it("вариант не из списка не принимается", () => {
    // Иначе в YouTube уехал бы несуществующий уровень доступа.
    assert.equal(resolveSettings("YOUTUBE", { privacy: "совершенно-публично" }).privacy, "public");
  });

  it("без сохранённых значений берутся умолчания", () => {
    assert.deepEqual(resolveSettings("INSTAGRAM", null), defaultSettings("INSTAGRAM"));
  });

  it("у Facebook настраивать нечего", () => {
    assert.equal(hasSettings("FACEBOOK"), false);
    assert.equal(hasSettings("YOUTUBE"), true);
  });
});

describe("Обложка", () => {
  it("кадр не уходит за конец ролика", () => {
    assert.equal(clampCoverMs(99_999, 10_000), 9_999);
    assert.equal(clampCoverMs(-5, 10_000), 0);
    assert.equal(clampCoverMs(500, 0), 0);
  });

  it("пять кандидатов по длительности", () => {
    const c = candidateTimestamps(10_000);
    assert.deepEqual(c, [1000, 3000, 5000, 7000, 9000]);
    assert.deepEqual(candidateTimestamps(0), []);
  });

  it("время показывается понятно", () => {
    assert.equal(formatTimecode(0), "0:00");
    assert.equal(formatTimecode(7_000), "0:07");
    assert.equal(formatTimecode(95_000), "1:35");
    assert.equal(formatTimecode(3_723_000), "1:02:03");
  });
});
