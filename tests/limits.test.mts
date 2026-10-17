/**
 * Проверки лимитов текста по сетям. Ошибка тут = отказ площадки уже после
 * загрузки видео, поэтому считаем ровно так, как считает сама площадка.
 * Запуск: npm test
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  captionIssues,
  measureFor,
  sanitizeYoutube,
  truncateBytes,
  utf8Bytes,
  youtubeTitleFrom,
} from "../src/lib/limits.ts";

describe("YouTube", () => {
  it("описание считается в байтах: кириллица — два байта на букву", () => {
    // Первая строка — короткая: иначе сработает ещё и лимит заголовка.
    const ru = "Заголовок\n" + "я".repeat(3000); // ~6000 байт описания
    assert.equal(utf8Bytes("я".repeat(3000)), 6000);
    assert.ok(captionIssues("YOUTUBE", ru).errors.some((e) => /байт/.test(e)));
    // Та же длина латиницей — вдвое меньше байт и укладывается в лимит.
    assert.equal(captionIssues("YOUTUBE", "Заголовок\n" + "a".repeat(3000)).errors.length, 0);
  });

  it("заголовок — первая непустая строка, лимит 100 символов", () => {
    assert.equal(youtubeTitleFrom("\n\n  Привет  \nвторая строка"), "Привет");
    assert.ok(captionIssues("YOUTUBE", "я".repeat(120) + "\nописание").errors.some((e) => /аголовок/.test(e)));
  });

  it("угловые скобки заменяются, а не ломают публикацию", () => {
    assert.equal(sanitizeYoutube("a <b> c"), "a ‹b› c");
    assert.ok(captionIssues("YOUTUBE", "видео <тест>").warnings.length > 0);
  });

  it("больше 15 хештегов — предупреждение, но не запрет", () => {
    const tags = Array.from({ length: 20 }, (_, i) => `#t${i}`).join(" ");
    const r = captionIssues("YOUTUBE", tags);
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.some((w) => /хештег/.test(w)));
  });

  it("обрезка по байтам не рвёт символ пополам", () => {
    const cut = truncateBytes("яяяя", 5); // 2 байта на букву → влезает 2
    assert.equal(cut, "яя");
    assert.ok(utf8Bytes(cut) <= 5);
  });
});

describe("Instagram", () => {
  it("лимит 2200 символов", () => {
    assert.equal(captionIssues("INSTAGRAM", "a".repeat(2200)).errors.length, 0);
    assert.ok(captionIssues("INSTAGRAM", "a".repeat(2201)).errors.length > 0);
  });

  it("не больше 30 хештегов", () => {
    const ok = Array.from({ length: 30 }, (_, i) => `#t${i}`).join(" ");
    const tooMany = Array.from({ length: 31 }, (_, i) => `#t${i}`).join(" ");
    assert.equal(captionIssues("INSTAGRAM", ok).errors.length, 0);
    assert.ok(captionIssues("INSTAGRAM", tooMany).errors.some((e) => /хештег/.test(e)));
  });

  it("не больше 20 упоминаний", () => {
    const many = Array.from({ length: 21 }, (_, i) => `@user${i}`).join(" ");
    assert.ok(captionIssues("INSTAGRAM", many).errors.some((e) => /упоминан/.test(e)));
  });

  it("решётка внутри слова за хештег не считается", () => {
    assert.equal(captionIssues("INSTAGRAM", "цвет#1 и цвет#2").errors.length, 0);
  });
});

describe("TikTok", () => {
  it("длинный текст не блокирует публикацию — API его не передаёт", () => {
    const r = captionIssues("TIKTOK", "a".repeat(5000));
    assert.equal(r.errors.length, 0);
    assert.ok(r.warnings.length > 0);
  });
});

describe("Счётчики для интерфейса", () => {
  it("для YouTube считают байты, для остальных символы", () => {
    assert.equal(measureFor("YOUTUBE", "яя").used, 4);
    assert.equal(measureFor("YOUTUBE", "яя").unit, "байт");
    assert.equal(measureFor("INSTAGRAM", "яя").used, 2);
  });

  it("эмодзи считается одним символом", () => {
    assert.equal(measureFor("INSTAGRAM", "🎬").used, 1);
  });
});
