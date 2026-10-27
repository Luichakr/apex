/**
 * «Поддержать друга»: проверка комментариев и видимости публикаций.
 * Запуск: npm test
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { checkComment, isPublicTarget } from "../src/lib/support";

describe("Комментарий друга", () => {
  it("нормальный тёплый текст проходит, пробелы схлопываются", () => {
    const r = checkComment("  Классный   монтаж,\nособенно финал!  ");
    assert.equal(r.ok, true);
    if (r.ok) assert.equal(r.text, "Классный монтаж, особенно финал!");
  });
  it("ссылки запрещены", () => {
    assert.equal(checkComment("Смотри https://spam.example").ok, false);
    assert.equal(checkComment("заходи на mysite.com").ok, false);
  });
  it("слишком короткий и слишком длинный не проходят", () => {
    assert.equal(checkComment("ок").ok, false);
    assert.equal(checkComment("а".repeat(301)).ok, false);
  });
  it("капс, повторы и россыпь @ и # не проходят", () => {
    assert.equal(checkComment("ОЧЕНЬ КРУТО ВСЕМ СОВЕТУЮ").ok, false);
    assert.equal(checkComment("круууууууто").ok, false);
    assert.equal(checkComment("#a #b #c классно").ok, false);
  });
  it("копию прежнего комментария отклоняет, даже с другой пунктуацией", () => {
    const r = checkComment("Классный монтаж!", ["классный  монтаж"]);
    assert.equal(r.ok, false);
  });
});

describe("Какие публикации можно трогать", () => {
  it("YouTube: только публичные", () => {
    assert.equal(isPublicTarget({ provider: "YOUTUBE", settings: { privacy: "public" } }), true);
    assert.equal(isPublicTarget({ provider: "YOUTUBE", settings: null }), true);
    assert.equal(isPublicTarget({ provider: "YOUTUBE", settings: { privacy: "unlisted" } }), false);
    assert.equal(isPublicTarget({ provider: "YOUTUBE", settings: { privacy: "private" } }), false);
  });
  it("LinkedIn: не «только контакты»", () => {
    assert.equal(isPublicTarget({ provider: "LINKEDIN", settings: { visibility: "PUBLIC" } }), true);
    assert.equal(isPublicTarget({ provider: "LINKEDIN", settings: { visibility: "CONNECTIONS" } }), false);
  });
  it("остальные сети поддержать нельзя", () => {
    assert.equal(isPublicTarget({ provider: "INSTAGRAM", settings: null }), false);
    assert.equal(isPublicTarget({ provider: "TIKTOK", settings: null }), false);
  });
});
