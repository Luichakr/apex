/**
 * Разбор ошибок площадок. Неверное решение здесь дорого стоит: лишний повтор
 * жжёт дневные лимиты сети, а отказ от повтора теряет публикацию.
 * Запуск: npm test
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  metaError,
  metaUsagePercent,
  nextYoutubeQuotaReset,
  parseRetryAfter,
  tiktokError,
  youtubeError,
} from "../src/lib/providers/errors.ts";

describe("Instagram (Meta)", () => {
  it("«видео ещё обрабатывается» — повторяем", () => {
    assert.equal(metaError("IG", 400, { code: 9007, error_subcode: 2207027 }).resolution, "retry");
    assert.equal(metaError("IG", 400, { error_subcode: 2207052 }).resolution, "retry");
  });

  it("дневной лимит 25 публикаций — повтор бессмыслен", () => {
    const e = metaError("IG", 400, { error_subcode: 2207042 });
    assert.equal(e.resolution, "permanent");
    assert.match(e.message, /25 публикаций/);
  });

  it("видео вне ограничений площадки — не повторяем", () => {
    assert.equal(metaError("IG", 400, { error_subcode: 2207053 }).resolution, "permanent");
    assert.equal(metaError("IG", 400, { error_subcode: 2207026 }).resolution, "permanent");
  });

  it("проверка безопасности Instagram — нужен повторный вход, а не обновление токена", () => {
    const e = metaError("IG", 400, { code: 190, error_subcode: 459 });
    assert.equal(e.resolution, "reconnect");
    assert.match(e.message, /проверку безопасности/);
  });

  it("истёкший доступ — повторный вход", () => {
    assert.equal(metaError("IG", 400, { code: 190 }).resolution, "reconnect");
  });

  it("превышение частоты — ждём и повторяем", () => {
    const e = metaError("IG", 400, { code: 80002 });
    assert.equal(e.resolution, "retry");
    assert.ok((e.retryAfterMs ?? 0) > 0);
  });

  it("невнятный сбой Meta считается временным", () => {
    assert.equal(metaError("IG", 500, { message: "An unknown error occurred" }).resolution, "retry");
  });

  it("Retry-After учитывается", () => {
    const e = metaError("IG", 429, { code: 4 }, 42_000);
    assert.equal(e.retryAfterMs, 42_000);
  });
});

describe("Лимит обращений Meta", () => {
  it("берёт худший показатель из заголовков", () => {
    const h = new Headers({
      "x-app-usage": JSON.stringify({ call_count: 10, total_time: 97, total_cputime: 3 }),
    });
    assert.equal(metaUsagePercent(h), 97);
  });

  it("смотрит и в business-use-case", () => {
    const h = new Headers({
      "x-business-use-case-usage": JSON.stringify({ "123": [{ call_count: 88 }] }),
    });
    assert.equal(metaUsagePercent(h), 88);
  });

  it("без заголовков считает, что запас есть", () => {
    assert.equal(metaUsagePercent(new Headers()), 0);
    // В заголовке HTTP допустима только латиница — проверяем мусор из ASCII.
    assert.equal(metaUsagePercent(new Headers({ "x-app-usage": "not-json" })), 0);
  });
});

describe("TikTok", () => {
  it("переполненные входящие — повтор не поможет", () => {
    const e = tiktokError("TikTok", 400, "spam_risk_too_many_pending_share");
    assert.equal(e.resolution, "permanent");
    assert.match(e.message, /опубликуйте или удалите/);
  });

  it("исчерпан лимит пользователей приложения — нужен повторный вход", () => {
    assert.equal(tiktokError("TikTok", 400, "reached_active_user_cap").resolution, "reconnect");
  });

  it("истёкший доступ — повторный вход", () => {
    assert.equal(tiktokError("TikTok", 401, "access_token_invalid").resolution, "reconnect");
  });

  it("отказы по формату и длительности окончательные", () => {
    for (const code of ["file_format_check_failed", "duration_check_failed", "frame_rate_check_failed"]) {
      assert.equal(tiktokError("TikTok", 400, code).resolution, "permanent", code);
    }
  });

  it("внутренний сбой и превышение частоты — повторяем", () => {
    assert.equal(tiktokError("TikTok", 500, "internal").resolution, "retry");
    assert.equal(tiktokError("TikTok", 429, "rate_limit_exceeded").resolution, "retry");
  });
});

describe("YouTube", () => {
  it("квота приходит как 403 — различаем по reason, а не по коду", () => {
    const e = youtubeError(403, "quotaExceeded", "quota");
    assert.equal(e.resolution, "permanent");
    assert.match(e.message, /квота/);
    // Тот же 403, но другая причина — это временный троттлинг.
    assert.equal(youtubeError(403, "rateLimitExceeded", "slow down").resolution, "retry");
  });

  it("ошибка доступа ведёт к повторному входу", () => {
    assert.equal(youtubeError(401, "invalid_grant", "bad grant").resolution, "reconnect");
  });

  it("отклонённые заголовок или описание — не повторять", () => {
    assert.equal(youtubeError(400, "invalidDescription", "bad").resolution, "permanent");
  });

  it("квота обнуляется в будущем", () => {
    const reset = nextYoutubeQuotaReset();
    assert.ok(reset.getTime() > Date.now());
    assert.ok(reset.getTime() - Date.now() <= 25 * 3600_000);
  });
});

describe("Retry-After", () => {
  it("понимает и секунды, и дату", () => {
    assert.equal(parseRetryAfter("120"), 120_000);
    const soon = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfter(soon) ?? 0;
    assert.ok(ms > 50_000 && ms <= 61_000, String(ms));
    assert.equal(parseRetryAfter(null), undefined);
  });
});
