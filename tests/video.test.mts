/**
 * Проверки выбора версии видео под сеть. Самая рискованная логика: ошибка тут
 * либо портит качество, либо приводит к отказу площадки.
 * Запуск: npm test
 */
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { planRendition, type MediaInfo } from "../src/lib/video.ts";

/** Заготовка результата ffprobe: обычный вертикальный ролик с телефона. */
function media(over: Partial<MediaInfo> = {}, video: Partial<NonNullable<MediaInfo["video"]>> = {}): MediaInfo {
  return {
    formatName: "mov,mp4,m4a,3gp,3g2,mj2",
    duration: 30,
    sizeBytes: 40 * 1024 * 1024,
    bitRate: 10_000_000,
    audioTracks: 1,
    otherStreams: 0,
    audio: { codec: "aac", sampleRate: 48_000, channels: 2, bitRate: 128_000 },
    video: {
      codec: "h264",
      pixFmt: "yuv420p",
      bitDepth: 8,
      width: 1080,
      height: 1920,
      displayWidth: 1080,
      displayHeight: 1920,
      rotation: 0,
      fps: 30,
      bitRate: 10_000_000,
      hdr: false,
      dolbyVision: false,
      interlaced: false,
      ...video,
    },
    ...over,
  };
}

describe("YouTube", () => {
  it("всегда отдаёт оригинал без перекодирования", () => {
    for (const v of [{}, { codec: "hevc" }, { hdr: true, bitDepth: 10 }, { fps: 120 }, { displayWidth: 3840, displayHeight: 2160 }]) {
      assert.equal(planRendition("YOUTUBE", media({}, v)).plan.kind, "original");
    }
  });

  it("предупреждает, что горизонтальное видео не станет Shorts", () => {
    const r = planRendition("YOUTUBE", media({}, { displayWidth: 1920, displayHeight: 1080 }));
    assert.match(r.warnings.join(" "), /не Shorts/);
  });

  it("предупреждает про длительность больше 3 минут", () => {
    const r = planRendition("YOUTUBE", media({ duration: 400 }));
    assert.match(r.warnings.join(" "), /3 минут/);
  });
});

describe("TikTok", () => {
  it("подходящий файл только перепаковывает, без потери качества", () => {
    assert.equal(planRendition("TIKTOK", media()).plan.kind, "remux");
  });

  it("HEVC не перекодирует — TikTok его принимает", () => {
    assert.equal(planRendition("TIKTOK", media({}, { codec: "hevc" })).plan.kind, "remux");
  });

  it("120 fps приводит к 60", () => {
    const { plan } = planRendition("TIKTOK", media({}, { fps: 120 }));
    assert.equal(plan.kind, "encode");
    assert.equal(plan.kind === "encode" && plan.fps, 60);
  });

  it("HDR переводит в SDR", () => {
    const { plan } = planRendition("TIKTOK", media({}, { hdr: true, bitDepth: 10, codec: "hevc" }));
    assert.equal(plan.kind, "encode");
    assert.equal(plan.kind === "encode" && plan.tonemap, true);
  });

  it("не даёт опубликовать длиннее 10 минут", () => {
    assert.ok(planRendition("TIKTOK", media({ duration: 700 })).errors.length > 0);
  });

  it("сохраняет 4K без уменьшения", () => {
    const { plan } = planRendition("TIKTOK", media({}, { codec: "hevc", displayWidth: 2160, displayHeight: 3840, fps: 120 }));
    assert.equal(plan.kind, "encode");
    if (plan.kind === "encode") {
      assert.equal(plan.width, 2160);
      assert.equal(plan.height, 3840);
    }
  });

  it("VP8/VP9 переводит в H.264: в MP4 их не перепаковать", () => {
    for (const codec of ["vp8", "vp9"]) {
      const { plan } = planRendition("TIKTOK", media({ formatName: "matroska,webm" }, { codec }));
      assert.equal(plan.kind, "encode", codec);
    }
  });
});

describe("Instagram", () => {
  it("уже подходящий файл только перепаковывает", () => {
    const { plan } = planRendition("INSTAGRAM", media({ sizeBytes: 40 * 1024 * 1024 }, { bitRate: 8_000_000 }));
    assert.equal(plan.kind, "remux");
  });

  it("4K уменьшает до 1080 по короткой стороне", () => {
    const { plan } = planRendition("INSTAGRAM", media({}, { displayWidth: 2160, displayHeight: 3840 }));
    assert.equal(plan.kind, "encode");
    if (plan.kind === "encode") {
      assert.equal(plan.width, 1080);
      assert.equal(plan.height, 1920);
    }
  });

  it("горизонтальное 4K ограничивает по ширине 1920", () => {
    const { plan } = planRendition("INSTAGRAM", media({}, { displayWidth: 3840, displayHeight: 2160 }));
    assert.equal(plan.kind, "encode");
    if (plan.kind === "encode") assert.ok(plan.width <= 1920);
  });

  it("HEVC переводит в H.264", () => {
    const { plan } = planRendition("INSTAGRAM", media({}, { codec: "hevc" }));
    assert.equal(plan.kind, "encode");
  });

  it("держит битрейт в пределах лимита площадки", () => {
    const { plan } = planRendition("INSTAGRAM", media({}, { bitRate: 80_000_000 }));
    assert.equal(plan.kind, "encode");
    if (plan.kind === "encode") assert.ok(plan.maxrateKbps! <= 24_000);
  });

  it("для длинного видео снижает битрейт, чтобы влезть в 300 МБ", () => {
    const { plan } = planRendition("INSTAGRAM", media({ duration: 600 }, { bitRate: 40_000_000 }));
    assert.equal(plan.kind, "encode");
    // 300 МБ на 600 с — это примерно 4 Мбит/с, никак не 24.
    if (plan.kind === "encode") assert.ok(plan.maxrateKbps! < 5000, `${plan.maxrateKbps}`);
  });

  it("не пропускает видео короче 3 секунд и длиннее 15 минут", () => {
    assert.ok(planRendition("INSTAGRAM", media({ duration: 2 })).errors.length > 0);
    assert.ok(planRendition("INSTAGRAM", media({ duration: 1000 })).errors.length > 0);
  });

  it("повёрнутое видео с телефона считает по видимым сторонам", () => {
    // iPhone пишет 1920×1080 с поворотом -90: зритель видит вертикальное.
    const { plan } = planRendition(
      "INSTAGRAM",
      media({}, { width: 1920, height: 1080, displayWidth: 1080, displayHeight: 1920, rotation: -90, codec: "hevc" })
    );
    assert.equal(plan.kind, "encode");
    if (plan.kind === "encode") {
      assert.equal(plan.width, 1080);
      assert.equal(plan.height, 1920);
    }
  });

  it("звук не в AAC пережимает, видео при этом не трогает", () => {
    const { plan } = planRendition(
      "INSTAGRAM",
      media({ audio: { codec: "opus", sampleRate: 48_000, channels: 2 } }, { bitRate: 8_000_000 })
    );
    assert.equal(plan.kind, "remux");
    assert.equal(plan.kind === "remux" && plan.audio.mode, "aac");
  });
});

describe("Telegram", () => {
  it("история приводится ровно к 720×1280 в H.265", () => {
    const { plan } = planRendition("TELEGRAM", media({ duration: 20 }), "story");
    assert.equal(plan.kind, "encode");
    if (plan.kind === "encode") {
      assert.equal(plan.width, 720);
      assert.equal(plan.height, 1280);
      assert.equal(plan.codec, "hevc");
      assert.equal(plan.gopSeconds, 1); // требование Telegram
      assert.equal(plan.cropToFit, true); // без чёрных полей
    }
  });

  it("история длиннее минуты не принимается", () => {
    const r = planRendition("TELEGRAM", media({ duration: 61 }), "story");
    assert.ok(r.errors.some((e) => /60 секунд/.test(e)));
    assert.equal(planRendition("TELEGRAM", media({ duration: 59 }), "story").errors.length, 0);
  });

  it("история укладывается в 30 МБ по битрейту", () => {
    const { plan } = planRendition("TELEGRAM", media({ duration: 60 }), "story");
    // 30 МБ на 60 с — это примерно 4 Мбит/с, не больше.
    if (plan.kind === "encode") assert.ok(plan.maxrateKbps! <= 4200, String(plan.maxrateKbps));
  });

  it("горизонтальный кадр для истории предупреждает об обрезке", () => {
    const r = planRendition(
      "TELEGRAM",
      media({ duration: 10 }, { displayWidth: 1920, displayHeight: 1080 }),
      "story"
    );
    assert.ok(r.warnings.some((w) => /обрезан/.test(w)));
  });

  it("подходящее видео в канал только перепаковывается", () => {
    const { plan } = planRendition("TELEGRAM", media({ sizeBytes: 30 * 1024 * 1024 }));
    assert.equal(plan.kind, "remux");
  });

  it("файл больше 50 МБ для канала сжимается", () => {
    const { plan } = planRendition("TELEGRAM", media({ sizeBytes: 120 * 1024 * 1024, duration: 120 }));
    assert.equal(plan.kind, "encode");
    if (plan.kind === "encode") assert.match(plan.reason, /50 МБ/);
  });
});
