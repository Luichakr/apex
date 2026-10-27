/**
 * Видео-конвейер APX: «мастер» хранится нетронутым, а под каждую сеть
 * готовится своя версия (rendition) строго по её официальным требованиям.
 *
 * Принцип качества:
 *  - YouTube   → оригинал как есть (YouTube принимает HEVC/HDR/4K/60fps и сам
 *                делает лучшие версии; любая перекодировка тут — только потеря).
 *  - TikTok    → если файл уже подходит — только перепаковка в MP4 без
 *                перекодирования (ноль потерь). Иначе — H.264 CRF 16 в том же
 *                разрешении (до 4K) и FPS.
 *  - Instagram → самые строгие правила API (≤1920 по ширине, ≤25 Мбит/с,
 *                23–60 fps, AAC 48 кГц, без edit list, ≤300 МБ). Если подходит —
 *                перепаковка без потерь; иначе H.264 CRF 17 preset slow
 *                ровно в том разрешении, которое Instagram показывает (короткая
 *                сторона 1080), с масштабированием lanczos.
 *  - HDR (iPhone HLG/Dolby Vision) для Instagram/TikTok корректно
 *    тонмапится в SDR BT.709 — иначе цвета «выцветают».
 */
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { rename, stat, unlink } from "node:fs/promises";
import type { Provider } from "@prisma/client";

const execFileP = promisify(execFile);

// ---------------------------------------------------------------------------
// Анализ файла (ffprobe)
// ---------------------------------------------------------------------------

export type VideoStreamInfo = {
  codec: string;
  profile?: string;
  pixFmt?: string;
  bitDepth: number;
  width: number;
  height: number;
  /** Размеры с учётом поворота (как видит зритель). */
  displayWidth: number;
  displayHeight: number;
  rotation: number;
  fps: number;
  bitRate?: number;
  colorTransfer?: string;
  colorPrimaries?: string;
  colorSpace?: string;
  hdr: boolean;
  dolbyVision: boolean;
  interlaced: boolean;
};

export type AudioStreamInfo = {
  codec: string;
  sampleRate: number;
  channels: number;
  bitRate?: number;
};

export type MediaInfo = {
  formatName: string;
  duration: number;
  sizeBytes: number;
  bitRate?: number;
  video: VideoStreamInfo | null;
  audio: AudioStreamInfo | null;
  audioTracks: number;
  otherStreams: number;
};

type ProbeStream = {
  codec_type?: string;
  codec_name?: string;
  profile?: string;
  pix_fmt?: string;
  bits_per_raw_sample?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  color_transfer?: string;
  color_primaries?: string;
  color_space?: string;
  field_order?: string;
  tags?: Record<string, string>;
  side_data_list?: { side_data_type?: string; rotation?: number }[];
  disposition?: { attached_pic?: number };
};

function parseRate(r?: string): number {
  if (!r) return 0;
  const [n, d] = r.split("/").map(Number);
  if (!d) return Number(n) || 0;
  return n / d;
}

const HDR_TRANSFERS = new Set(["smpte2084", "arib-std-b67"]);

export async function probeMedia(path: string): Promise<MediaInfo> {
  const { stdout } = await execFileP(
    "ffprobe",
    ["-v", "error", "-show_format", "-show_streams", "-of", "json", path],
    { maxBuffer: 1 << 24, timeout: 30_000 }
  );
  const j = JSON.parse(stdout) as {
    format?: { format_name?: string; duration?: string; size?: string; bit_rate?: string };
    streams?: ProbeStream[];
  };
  const streams = j.streams ?? [];
  const vids = streams.filter(
    (s) => s.codec_type === "video" && !s.disposition?.attached_pic
  );
  const auds = streams.filter((s) => s.codec_type === "audio");
  // Первая «нормальная» аудиодорожка (у iPhone ещё бывает пространственная APAC).
  const a =
    auds.find((s) => s.codec_name && s.codec_name !== "apac") ?? auds[0];
  const v = vids[0];

  let video: VideoStreamInfo | null = null;
  if (v && v.width && v.height) {
    const sideRot = v.side_data_list?.find((d) => typeof d.rotation === "number")
      ?.rotation;
    const rotation = Math.round(Number(sideRot ?? v.tags?.rotate ?? 0)) % 360;
    const swap = Math.abs(rotation) === 90 || Math.abs(rotation) === 270;
    const pix = v.pix_fmt ?? "";
    const bitDepth =
      Number(v.bits_per_raw_sample) ||
      (/p10|p12|10le|12le|10be/.test(pix) ? (/12/.test(pix) ? 12 : 10) : 8);
    const avg = parseRate(v.avg_frame_rate);
    const fps = avg > 0 && avg < 1000 ? avg : parseRate(v.r_frame_rate);
    const dolbyVision = Boolean(
      v.side_data_list?.some((d) => /DOVI/i.test(d.side_data_type ?? "")) ||
        v.codec_name === "dvhe" ||
        v.codec_name === "dvh1"
    );
    video = {
      codec: v.codec_name ?? "unknown",
      profile: v.profile,
      pixFmt: v.pix_fmt,
      bitDepth,
      width: v.width,
      height: v.height,
      displayWidth: swap ? v.height : v.width,
      displayHeight: swap ? v.width : v.height,
      rotation,
      fps: Math.round(fps * 1000) / 1000,
      bitRate: v.bit_rate ? Number(v.bit_rate) : undefined,
      colorTransfer: v.color_transfer,
      colorPrimaries: v.color_primaries,
      colorSpace: v.color_space,
      hdr: HDR_TRANSFERS.has(v.color_transfer ?? "") || dolbyVision,
      dolbyVision,
      interlaced: Boolean(
        v.field_order && !["progressive", "unknown"].includes(v.field_order)
      ),
    };
  }

  const audio: AudioStreamInfo | null = a
    ? {
        codec: a.codec_name ?? "unknown",
        sampleRate: Number(a.sample_rate) || 0,
        channels: a.channels ?? 0,
        bitRate: a.bit_rate ? Number(a.bit_rate) : undefined,
      }
    : null;

  return {
    formatName: j.format?.format_name ?? "",
    duration: Number(j.format?.duration) || 0,
    sizeBytes: Number(j.format?.size) || 0,
    bitRate: j.format?.bit_rate ? Number(j.format.bit_rate) : undefined,
    video,
    audio,
    audioTracks: auds.length,
    otherStreams: streams.length - vids.length - auds.length,
  };
}

/** Контейнер мастера → MIME-тип (по фактическому содержимому, не по браузеру). */
export function mimeFromProbe(info: MediaInfo, fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (info.formatName.includes("mp4") || info.formatName.includes("mov")) {
    return ext === "mov" || ext === "qt" ? "video/quicktime" : "video/mp4";
  }
  if (info.formatName.includes("webm") || info.formatName.includes("matroska")) {
    return ext === "webm" ? "video/webm" : "video/x-matroska";
  }
  return "application/octet-stream";
}

export function isMp4Family(info: MediaInfo): boolean {
  return info.formatName.includes("mp4") || info.formatName.includes("mov");
}

// ---------------------------------------------------------------------------
// Требования площадок (официальная документация API)
// ---------------------------------------------------------------------------

export const PLATFORM_SPECS = {
  INSTAGRAM: {
    // developers.facebook.com → Instagram Platform → Content Publishing → Reels specs
    minDuration: 3,
    maxDuration: 15 * 60,
    maxBytes: 300 * 1024 * 1024,
    maxWidth: 1920,
    // Instagram показывает Reels максимум 1080 по короткой стороне: отдаём
    // ровно это разрешение с запасом битрейта, а не даём ему масштабировать самому.
    targetShortSide: 1080,
    fpsMin: 23,
    fpsMax: 60,
    maxVideoKbps: 24_000, // лимит 25 Мбит/с, держим запас
    audioKbps: 128,
    audioRate: 48_000,
  },
  TIKTOK: {
    // developers.tiktok.com → Content Posting API → Media transfer guide
    maxDuration: 10 * 60,
    maxBytes: 4 * 1024 * 1024 * 1024,
    minSide: 360,
    maxSide: 4096,
    fpsMin: 23,
    fpsMax: 60,
    codecs: ["h264", "hevc", "vp8", "vp9"],
  },
  YOUTUBE: {
    // Shorts: вертикальное/квадратное видео до 3 минут.
    shortsMaxDuration: 180,
  },
  // Истории Telegram: требования жёсткие и непохожие на остальные —
  // ровно 720×1280, H.265, ключевой кадр раз в секунду, до 30 МБ и 60 секунд.
  TELEGRAM_STORY: {
    width: 720,
    height: 1280,
    maxDuration: 60,
    maxBytes: 30 * 1024 * 1024,
    audioKbps: 128,
    audioRate: 48_000,
  },
  // Видео в канал: Bot API принимает загрузку не больше 50 МБ.
  TELEGRAM_CHANNEL: {
    maxBytes: 50 * 1024 * 1024,
  },
  // LinkedIn: MP4, 3 c – 30 мин, до 500 МБ. Ориентацию не трогаем.
  LINKEDIN: {
    minDuration: 3,
    maxDuration: 30 * 60,
    maxBytes: 500 * 1024 * 1024,
  },
} as const;

// ---------------------------------------------------------------------------
// План версии под сеть
// ---------------------------------------------------------------------------

export type RenditionPlan =
  | { kind: "original"; reason: string }
  | {
      kind: "remux";
      reason: string;
      audio: AudioPlan;
      dropEditList: boolean;
    }
  | {
      kind: "encode";
      reason: string;
      width: number;
      height: number;
      fps: number | null; // null = как у исходника
      tonemap: boolean;
      crf: number;
      preset: string;
      maxrateKbps: number | null;
      audio: AudioPlan;
      dropEditList: boolean;
      /** Кодек видео. По умолчанию H.264. */
      codec?: "h264" | "hevc";
      /** Ключевой кадр раз в N секунд (по умолчанию 2). */
      gopSeconds?: number;
      /** Обрезать кадр до нужного размера вместо вписывания с полями. */
      cropToFit?: boolean;
    };

export type AudioPlan =
  | { mode: "none" }
  | { mode: "copy" }
  | { mode: "aac"; kbps: number; rate: number; channels: number };

export type PlanResult = {
  plan: RenditionPlan;
  /** Предупреждения для пользователя (публикация всё равно пойдёт). */
  warnings: string[];
  /** Блокирующие проблемы: сеть такое видео не примет. */
  errors: string[];
};

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

function fitInside(
  w: number,
  h: number,
  limits: { maxWidth?: number; maxShort?: number; maxLong?: number }
): { width: number; height: number } {
  let k = 1;
  if (limits.maxWidth) k = Math.min(k, limits.maxWidth / w);
  if (limits.maxShort) k = Math.min(k, limits.maxShort / Math.min(w, h));
  if (limits.maxLong) k = Math.min(k, limits.maxLong / Math.max(w, h));
  if (k >= 1) return { width: even(w), height: even(h) };
  return { width: even(w * k), height: even(h * k) };
}

function clampFps(fps: number, min: number, max: number): number | null {
  if (!fps) return null;
  if (fps > max + 0.01) return max; // 120/240 fps → 60
  if (fps < min - 0.01) return 30; // таймлапсы и т.п. → 30
  return null; // оставляем как есть
}

export function planRendition(
  provider: Provider,
  info: MediaInfo,
  variant?: string | null
): PlanResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const v = info.video;
  if (!v) {
    return {
      plan: { kind: "original", reason: "нет видеодорожки" },
      warnings,
      errors: ["В файле не найдена видеодорожка"],
    };
  }
  const isVertical = v.displayHeight >= v.displayWidth;

  if (provider === "TELEGRAM") {
    return variant === "story"
      ? planTelegramStory(info, v, warnings)
      : planTelegramChannel(info, v, warnings);
  }

  if (provider === "LINKEDIN") {
    return planLinkedin(info, v, warnings);
  }

  if (provider === "YOUTUBE" || provider === "FACEBOOK") {
    if (provider === "YOUTUBE") {
      if (info.duration > PLATFORM_SPECS.YOUTUBE.shortsMaxDuration) {
        warnings.push(
          "YouTube: видео длиннее 3 минут — выйдет обычным видео, не Shorts"
        );
      } else if (!isVertical) {
        warnings.push(
          "YouTube: горизонтальное видео — выйдет обычным видео, не Shorts"
        );
      }
    }
    return {
      plan: { kind: "original", reason: "оригинал без изменений — максимум качества" },
      warnings,
      errors,
    };
  }

  if (provider === "TIKTOK") {
    const s = PLATFORM_SPECS.TIKTOK;
    if (info.duration > s.maxDuration) {
      errors.push(`TikTok: видео ${fmtDur(info.duration)} — максимум 10 минут`);
    }
    const fpsFix = clampFps(v.fps, s.fpsMin, s.fpsMax);
    const minSide = Math.min(v.displayWidth, v.displayHeight);
    const maxSide = Math.max(v.displayWidth, v.displayHeight);
    if (minSide < s.minSide) {
      errors.push(`TikTok: разрешение ${v.displayWidth}×${v.displayHeight} — минимум 360 px`);
    }
    // TikTok принимает и VP8/VP9, но перепаковать их в MP4 нельзя (VP8 в этот
    // контейнер не кладётся вовсе), поэтому такие ролики переводим в H.264.
    const codecOk = v.codec === "h264" || v.codec === "hevc";
    const sizeFix = maxSide > s.maxSide;
    const needEncode =
      !codecOk || v.hdr || v.interlaced || fpsFix !== null || sizeFix || v.bitDepth > 8 && v.codec === "h264";

    if (!needEncode) {
      return {
        plan: {
          kind: "remux",
          reason: "файл уже подходит TikTok — перепаковка без перекодирования",
          audio: audioFor(info, { kbps: 256, rate: 48_000, maxChannels: 2, allowCopy: true }),
          dropEditList: false,
        },
        warnings,
        errors,
      };
    }
    const dims = fitInside(v.displayWidth, v.displayHeight, { maxLong: 3840 });
    const reasons = [
      !codecOk && `${v.codec.toUpperCase()} → H.264`,
      v.hdr && "HDR → SDR",
      v.interlaced && "чересстрочное",
      fpsFix !== null && `${Math.round(v.fps)} fps → ${fpsFix}`,
      sizeFix && `${maxSide}px → 3840`,
    ].filter(Boolean);
    return {
      plan: {
        kind: "encode",
        reason: `перекодирование: ${reasons.join(", ")}`,
        ...dims,
        fps: fpsFix,
        tonemap: v.hdr,
        crf: 16,
        preset: "slow",
        maxrateKbps: null,
        audio: audioFor(info, { kbps: 256, rate: 48_000, maxChannels: 2, allowCopy: true }),
        dropEditList: false,
      },
      warnings,
      errors,
    };
  }

  // INSTAGRAM
  const s = PLATFORM_SPECS.INSTAGRAM;
  if (info.duration && info.duration < s.minDuration) {
    errors.push(`Instagram: видео ${fmtDur(info.duration)} — минимум 3 секунды`);
  }
  if (info.duration > s.maxDuration) {
    errors.push(`Instagram: видео ${fmtDur(info.duration)} — максимум 15 минут`);
  }
  const fpsFix = clampFps(v.fps, s.fpsMin, s.fpsMax);
  const dims = fitInside(v.displayWidth, v.displayHeight, {
    maxWidth: s.maxWidth,
    maxShort: s.targetShortSide,
  });
  const resize = dims.width !== even(v.displayWidth) || dims.height !== even(v.displayHeight);
  const videoKbps = (v.bitRate ?? info.bitRate ?? 0) / 1000;
  // Бюджет битрейта, чтобы файл гарантированно влез в 300 МБ.
  const budgetKbps = info.duration
    ? Math.floor((s.maxBytes * 8 * 0.9) / info.duration / 1000) - s.audioKbps
    : s.maxVideoKbps;
  const maxrate = Math.max(1500, Math.min(s.maxVideoKbps, budgetKbps));
  if (budgetKbps < 4000) {
    warnings.push(
      "Instagram: из-за лимита 300 МБ длинное видео получит битрейт ниже идеального"
    );
  }
  const audioOk =
    !info.audio ||
    (info.audio.codec === "aac" &&
      info.audio.channels <= 2 &&
      info.audio.sampleRate <= 48_000 &&
      (info.audio.bitRate ?? 0) <= 130_000);
  const compliant =
    v.codec === "h264" &&
    v.pixFmt === "yuv420p" &&
    v.bitDepth === 8 &&
    !v.hdr &&
    !v.interlaced &&
    fpsFix === null &&
    !resize &&
    videoKbps > 0 &&
    videoKbps <= maxrate &&
    info.sizeBytes <= s.maxBytes * 0.97 &&
    isMp4Family(info);

  if (compliant && audioOk) {
    return {
      plan: {
        kind: "remux",
        reason: "файл уже подходит Instagram — перепаковка без перекодирования",
        audio: info.audio ? { mode: "copy" } : { mode: "none" },
        dropEditList: true,
      },
      warnings,
      errors,
    };
  }
  if (compliant && !audioOk) {
    // Видео идеальное — пережимаем только звук.
    return {
      plan: {
        kind: "remux",
        reason: "видео подходит Instagram без изменений, звук → AAC 48 кГц",
        audio: audioFor(info, { kbps: s.audioKbps, rate: s.audioRate, maxChannels: 2, allowCopy: false }),
        dropEditList: true,
      },
      warnings,
      errors,
    };
  }
  const reasons = [
    v.codec !== "h264" && `${v.codec.toUpperCase()} → H.264`,
    v.hdr && "HDR → SDR",
    resize && `${v.displayWidth}×${v.displayHeight} → ${dims.width}×${dims.height}`,
    fpsFix !== null && `${Math.round(v.fps)} fps → ${fpsFix}`,
    videoKbps > maxrate && `битрейт ${Math.round(videoKbps / 1000)} → ≤${Math.round(maxrate / 1000)} Мбит/с`,
    v.bitDepth > 8 && !v.hdr && "10 бит → 8 бит",
  ].filter(Boolean);
  return {
    plan: {
      kind: "encode",
      reason: `перекодирование: ${reasons.join(", ") || "приведение к спецификации"}`,
      ...dims,
      fps: fpsFix,
      tonemap: v.hdr,
      crf: 17,
      preset: "slow",
      maxrateKbps: maxrate,
      audio: audioFor(info, { kbps: s.audioKbps, rate: s.audioRate, maxChannels: 2, allowCopy: false }),
      dropEditList: true,
    },
    warnings,
    errors,
  };
}

/**
 * История Telegram. Формат задан жёстко, поэтому перекодируем почти всегда:
 * кадр приводится к 720×1280 обрезкой по центру, чтобы не было полей.
 */
function planTelegramStory(
  info: MediaInfo,
  v: VideoStreamInfo,
  warnings: string[]
): PlanResult {
  const s = PLATFORM_SPECS.TELEGRAM_STORY;
  const errors: string[] = [];
  if (info.duration > s.maxDuration) {
    errors.push(`Telegram: история ${fmtDur(info.duration)} — максимум 60 секунд`);
  }
  if (Math.abs(v.displayWidth / v.displayHeight - 720 / 1280) > 0.02) {
    warnings.push("Telegram: кадр не 9:16 — для истории он будет обрезан по центру");
  }
  // Бюджет на 30 МБ с запасом; у коротких роликов потолок не мешает.
  const budgetKbps = info.duration
    ? Math.floor((s.maxBytes * 8 * 0.9) / info.duration / 1000) - s.audioKbps
    : 4000;
  return {
    plan: {
      kind: "encode",
      reason: "перекодирование под историю Telegram: 720×1280, H.265",
      width: s.width,
      height: s.height,
      fps: clampFps(v.fps, 23, 60),
      tonemap: v.hdr,
      crf: 26, // H.265 при том же числе даёт заметно меньший файл, чем H.264
      preset: "medium",
      maxrateKbps: Math.max(1200, Math.min(8000, budgetKbps)),
      audio: audioFor(info, { kbps: s.audioKbps, rate: s.audioRate, maxChannels: 2, allowCopy: false }),
      dropEditList: true,
      codec: "hevc",
      gopSeconds: 1, // требование Telegram: ключевой кадр каждую секунду
      cropToFit: true,
    },
    warnings,
    errors,
  };
}

/** LinkedIn: нужен MP4/H.264 в пределах 500 МБ; ориентацию сохраняем. */
function planLinkedin(
  info: MediaInfo,
  v: VideoStreamInfo,
  warnings: string[]
): PlanResult {
  const s = PLATFORM_SPECS.LINKEDIN;
  const errors: string[] = [];
  if (info.duration && info.duration < s.minDuration) {
    errors.push(`LinkedIn: видео ${fmtDur(info.duration)} — минимум 3 секунды`);
  }
  if (info.duration > s.maxDuration) {
    errors.push(`LinkedIn: видео ${fmtDur(info.duration)} — максимум 30 минут`);
  }
  const fpsFix = clampFps(v.fps, 23, 60);
  const fits = info.sizeBytes <= s.maxBytes * 0.95;
  const compliant =
    v.codec === "h264" && v.pixFmt === "yuv420p" && !v.hdr && !v.interlaced && fpsFix === null;

  if (compliant && fits && isMp4Family(info)) {
    return {
      plan: {
        kind: "remux",
        reason: "файл уже подходит LinkedIn — перепаковка без перекодирования",
        audio: info.audio ? { mode: "copy" } : { mode: "none" },
        dropEditList: true,
      },
      warnings,
      errors,
    };
  }

  const dims = fitInside(v.displayWidth, v.displayHeight, { maxLong: 1920 });
  const budgetKbps = info.duration
    ? Math.floor((s.maxBytes * 8 * 0.9) / info.duration / 1000) - 128
    : 12_000;
  const reasons = [
    v.codec !== "h264" && `${v.codec.toUpperCase()} → H.264`,
    v.hdr && "HDR → SDR",
    !fits && "файл больше 500 МБ",
    fpsFix !== null && `${Math.round(v.fps)} fps → ${fpsFix}`,
  ].filter(Boolean);
  return {
    plan: {
      kind: "encode",
      reason: `перекодирование под LinkedIn: ${reasons.join(", ") || "приведение к MP4/H.264"}`,
      ...dims,
      fps: fpsFix,
      tonemap: v.hdr,
      crf: 19,
      preset: "medium",
      maxrateKbps: Math.max(1500, Math.min(16_000, budgetKbps)),
      audio: audioFor(info, { kbps: 128, rate: 48_000, maxChannels: 2, allowCopy: false }),
      dropEditList: true,
    },
    warnings,
    errors,
  };
}

/** Видео в канал: обычный H.264, лишь бы влезало в лимит загрузки Bot API. */
function planTelegramChannel(
  info: MediaInfo,
  v: VideoStreamInfo,
  warnings: string[]
): PlanResult {
  const s = PLATFORM_SPECS.TELEGRAM_CHANNEL;
  const fpsFix = clampFps(v.fps, 23, 60);
  const fits = info.sizeBytes <= s.maxBytes * 0.95;
  const compliant =
    v.codec === "h264" && v.pixFmt === "yuv420p" && !v.hdr && !v.interlaced && fpsFix === null;

  if (compliant && fits && isMp4Family(info)) {
    return {
      plan: {
        kind: "remux",
        reason: "файл уже подходит Telegram — перепаковка без перекодирования",
        audio: info.audio ? { mode: "copy" } : { mode: "none" },
        dropEditList: true,
      },
      warnings,
      errors: [],
    };
  }

  const dims = fitInside(v.displayWidth, v.displayHeight, { maxLong: 1920 });
  const budgetKbps = info.duration
    ? Math.floor((s.maxBytes * 8 * 0.9) / info.duration / 1000) - 128
    : 8000;
  if (budgetKbps < 1500) {
    warnings.push(
      "Telegram: бот может загрузить не больше 50 МБ — длинное видео сильно сожмётся"
    );
  }
  return {
    plan: {
      kind: "encode",
      reason: fits
        ? "перекодирование под Telegram"
        : "перекодирование: файл больше 50 МБ, которые принимает бот",
      ...dims,
      fps: fpsFix,
      tonemap: v.hdr,
      crf: 20,
      preset: "medium",
      maxrateKbps: Math.max(800, Math.min(12_000, budgetKbps)),
      audio: audioFor(info, { kbps: 128, rate: 48_000, maxChannels: 2, allowCopy: false }),
      dropEditList: true,
    },
    warnings,
    errors: [],
  };
}

function audioFor(
  info: MediaInfo,
  o: { kbps: number; rate: number; maxChannels: number; allowCopy: boolean }
): AudioPlan {
  const a = info.audio;
  if (!a) return { mode: "none" };
  if (
    o.allowCopy &&
    a.codec === "aac" &&
    a.channels <= o.maxChannels &&
    a.sampleRate <= 48_000
  ) {
    return { mode: "copy" };
  }
  return {
    mode: "aac",
    kbps: o.kbps,
    rate: o.rate,
    channels: Math.max(1, Math.min(o.maxChannels, a.channels || 2)),
  };
}

function fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m ? `${m} мин ${s} с` : `${s} с`;
}

// ---------------------------------------------------------------------------
// Выполнение (ffmpeg)
// ---------------------------------------------------------------------------

let filterCache: Promise<Set<string>> | null = null;
function ffmpegFilters(): Promise<Set<string>> {
  filterCache ??= execFileP("ffmpeg", ["-hide_banner", "-filters"], {
    maxBuffer: 1 << 22,
  })
    .then(({ stdout }) => {
      const set = new Set<string>();
      for (const line of stdout.split("\n")) {
        const m = line.trim().match(/^\S+\s+(\S+)\s/);
        if (m) set.add(m[1]);
      }
      return set;
    })
    .catch(() => new Set<string>());
  return filterCache;
}

/** Цепочка тонмаппинга HDR → SDR BT.709. */
async function tonemapChain(): Promise<string> {
  const f = await ffmpegFilters();
  if (f.has("zscale")) {
    // Эталонная цепочка (libzimg): в линейный свет → BT.709 → Hable → гамма BT.709.
    return [
      "zscale=t=linear:npl=203",
      "format=gbrpf32le",
      "zscale=p=bt709",
      "tonemap=tonemap=hable:desat=0",
      "zscale=t=bt709:m=bt709:r=tv",
    ].join(",");
  }
  // ffmpeg 8+: встроенное управление цветом swscale (с тонмаппингом).
  return "scale=out_color_matrix=bt709:out_primaries=bt709:out_transfer=bt709:out_range=tv";
}

export type ProgressFn = (pct: number) => void;

function audioArgs(a: AudioPlan): string[] {
  if (a.mode === "none") return ["-an"];
  if (a.mode === "copy") return ["-c:a", "copy"];
  return [
    "-c:a",
    "aac",
    "-b:a",
    `${a.kbps}k`,
    "-ar",
    String(a.rate),
    "-ac",
    String(a.channels),
  ];
}

/** Собрать аргументы ffmpeg для плана (без входа/выхода). */
export async function buildFfmpegArgs(
  plan: Exclude<RenditionPlan, { kind: "original" }>,
  info: MediaInfo
): Promise<string[]> {
  const args: string[] = [
    "-map",
    "0:v:0",
    ...(plan.audio.mode === "none" ? [] : ["-map", "0:a:0?"]),
    "-dn",
    "-sn",
    "-map_chapters",
    "-1",
  ];
  if (plan.kind === "remux") {
    args.push("-c:v", "copy");
    if (info.video?.codec === "hevc") args.push("-tag:v", "hvc1");
    args.push(...audioArgs(plan.audio));
  } else {
    const vf: string[] = [];
    if (plan.tonemap) vf.push(await tonemapChain());
    if (plan.fps) vf.push(`fps=${plan.fps}`);
    if (plan.cropToFit) {
      // Сначала заполняем кадр целиком, затем срезаем лишнее по центру —
      // чёрных полей в истории быть не должно.
      vf.push(
        `scale=${plan.width}:${plan.height}:force_original_aspect_ratio=increase:flags=lanczos+accurate_rnd+full_chroma_int`,
        `crop=${plan.width}:${plan.height}`,
        "setsar=1",
        "format=yuv420p"
      );
    } else {
      vf.push(
        `scale=${plan.width}:${plan.height}:flags=lanczos+accurate_rnd+full_chroma_int`,
        "setsar=1",
        "format=yuv420p"
      );
    }
    const fps = plan.fps ?? info.video?.fps ?? 30;
    const gop = Math.max(12, Math.round(fps * (plan.gopSeconds ?? 2)));
    args.push(
      "-vf",
      vf.join(","),
      "-c:v",
      plan.codec === "hevc" ? "libx265" : "libx264",
      ...(plan.codec === "hevc" ? ["-tag:v", "hvc1"] : ["-profile:v", "high"]),
      "-preset",
      plan.preset,
      "-crf",
      String(plan.crf),
      "-pix_fmt",
      "yuv420p",
      // Закрытый GOP с ключевым кадром каждые 2 секунды (требование Instagram).
      "-g",
      String(gop),
      ...(plan.codec === "hevc"
        ? ["-x265-params", `keyint=${gop}:min-keyint=${gop}:open-gop=0:log-level=error`]
        : ["-x264-params", "open-gop=0:scenecut=40"]),
      "-colorspace",
      "bt709",
      "-color_primaries",
      "bt709",
      "-color_trc",
      "bt709",
      "-color_range",
      "tv"
    );
    if (plan.maxrateKbps) {
      args.push(
        "-maxrate",
        `${plan.maxrateKbps}k`,
        "-bufsize",
        `${plan.maxrateKbps * 2}k`
      );
    }
    args.push(...audioArgs(plan.audio));
  }
  args.push("-movflags", "+faststart");
  if (plan.dropEditList) args.push("-use_editlist", "0");
  return args;
}

/** Запустить ffmpeg с прогрессом. Пишет во временный файл, затем атомарно переименовывает. */
export async function runFfmpeg(
  input: string,
  output: string,
  args: string[],
  durationSec: number,
  onProgress?: ProgressFn,
  timeoutMs = 3 * 60 * 60 * 1000
): Promise<void> {
  const tmp = output.replace(/\.mp4$/, "") + ".part.mp4";
  await unlink(tmp).catch(() => {});
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      "ffmpeg",
      ["-hide_banner", "-nostats", "-y", "-i", input, ...args, "-progress", "pipe:1", "-f", "mp4", tmp],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let stderr = "";
    let last = -1;
    const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs);
    p.stdout.on("data", (buf: Buffer) => {
      const m = buf.toString().match(/out_time_us=(\d+)/g);
      if (!m || !durationSec || !onProgress) return;
      const us = Number(m[m.length - 1].split("=")[1]);
      const pct = Math.min(99, Math.floor((us / 1e6 / durationSec) * 100));
      if (pct >= last + 2) {
        last = pct;
        onProgress(pct);
      }
    });
    p.stderr.on("data", (b: Buffer) => {
      stderr = (stderr + b.toString()).slice(-4000);
    });
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else {
        const lastLines = stderr.trim().split("\n").slice(-3).join(" | ");
        reject(new Error(`ffmpeg завершился с кодом ${code}: ${lastLines}`));
      }
    });
  }).catch(async (e) => {
    await unlink(tmp).catch(() => {});
    throw e;
  });
  await rename(tmp, output);
}

export type RenditionMeta = {
  kind: RenditionPlan["kind"];
  reason: string;
  durationSec?: number;
  width?: number;
  height?: number;
  fps?: number;
  videoCodec?: string;
  videoKbps?: number;
  audio?: string;
  sizeBytes: number;
  warnings: string[];
};

/** Проверить готовый файл против правил сети (защита от отказа площадки). */
export function verifyRendition(provider: Provider, out: MediaInfo): string[] {
  const issues: string[] = [];
  const v = out.video;
  if (!v) return ["нет видеодорожки"];
  if (provider === "INSTAGRAM") {
    const s = PLATFORM_SPECS.INSTAGRAM;
    if (v.displayWidth > s.maxWidth) issues.push(`ширина ${v.displayWidth} > ${s.maxWidth}`);
    if (out.sizeBytes > s.maxBytes) issues.push(`размер ${(out.sizeBytes / 1048576).toFixed(0)} МБ > 300 МБ`);
    if (v.fps > s.fpsMax + 0.5 || v.fps < s.fpsMin - 0.5) issues.push(`fps ${v.fps}`);
    if (!["h264", "hevc"].includes(v.codec)) issues.push(`кодек ${v.codec}`);
    if (out.audio && out.audio.sampleRate > 48_000) issues.push("аудио > 48 кГц");
  }
  if (provider === "TELEGRAM") {
    // Проверяем только то, что обязательно: в историю уходит строго 720×1280.
    if (v.displayWidth === 720 && v.displayHeight === 1280) {
      const s = PLATFORM_SPECS.TELEGRAM_STORY;
      if (out.sizeBytes > s.maxBytes) issues.push(`размер ${(out.sizeBytes / 1048576).toFixed(0)} МБ > 30 МБ`);
      if (out.duration > s.maxDuration + 0.5) issues.push("длиннее 60 секунд");
    } else if (out.sizeBytes > PLATFORM_SPECS.TELEGRAM_CHANNEL.maxBytes) {
      issues.push(`размер ${(out.sizeBytes / 1048576).toFixed(0)} МБ > 50 МБ`);
    }
  }

  if (provider === "TELEGRAM") {
    // 720×1280 на выходе означает, что это версия под историю.
    if (v.displayWidth === 720 && v.displayHeight === 1280) {
      const t = PLATFORM_SPECS.TELEGRAM_STORY;
      if (out.sizeBytes > t.maxBytes) {
        issues.push(`размер ${(out.sizeBytes / 1048576).toFixed(0)} МБ > 30 МБ`);
      }
      if (out.duration > t.maxDuration + 0.5) issues.push("длиннее 60 секунд");
      if (v.codec !== "hevc") issues.push(`кодек ${v.codec}, а нужен H.265`);
    } else if (out.sizeBytes > PLATFORM_SPECS.TELEGRAM_CHANNEL.maxBytes) {
      issues.push(`размер ${(out.sizeBytes / 1048576).toFixed(0)} МБ > 50 МБ`);
    }
  }

  if (provider === "LINKEDIN") {
    if (out.sizeBytes > PLATFORM_SPECS.LINKEDIN.maxBytes) {
      issues.push(`размер ${(out.sizeBytes / 1048576).toFixed(0)} МБ > 500 МБ`);
    }
    if (!["h264", "hevc"].includes(v.codec)) issues.push(`кодек ${v.codec}`);
  }

  if (provider === "TIKTOK") {
    const s = PLATFORM_SPECS.TIKTOK;
    if (Math.max(v.displayWidth, v.displayHeight) > s.maxSide) issues.push("сторона > 4096");
    if (out.sizeBytes > s.maxBytes) issues.push("размер > 4 ГБ");
    if (v.fps > s.fpsMax + 0.5) issues.push(`fps ${v.fps}`);
  }
  return issues;
}

export function describeOutput(
  plan: RenditionPlan,
  out: MediaInfo,
  warnings: string[]
): RenditionMeta {
  const v = out.video;
  return {
    kind: plan.kind,
    reason: plan.reason,
    durationSec: out.duration || undefined,
    width: v?.displayWidth,
    height: v?.displayHeight,
    fps: v ? Math.round(v.fps * 100) / 100 : undefined,
    videoCodec: v?.codec,
    videoKbps: v?.bitRate
      ? Math.round(v.bitRate / 1000)
      : out.bitRate
        ? Math.round(out.bitRate / 1000)
        : undefined,
    audio: out.audio
      ? `${out.audio.codec} ${Math.round((out.audio.bitRate ?? 0) / 1000)}k ${out.audio.sampleRate / 1000}kHz`
      : "нет",
    sizeBytes: out.sizeBytes,
    warnings,
  };
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size;
}

/** Путь к кадру-обложке для интерфейса. */
export function posterPathFor(masterPath: string): string {
  return masterPath.replace(/\.[^./]+$/, "") + ".poster.jpg";
}

/** Кадр-обложка (для списка публикаций). HDR тонмапится, чтобы не был серым. */
export async function makePoster(masterPath: string, info: MediaInfo): Promise<string | null> {
  const out = posterPathFor(masterPath);
  // 10% длительности, но не позже 5-й секунды: первый кадр часто чёрный.
  const at = info.duration > 0.2 ? Math.min(5, Math.max(0.05, info.duration * 0.1)) : 0;
  const vf = [
    ...(info.video?.hdr ? [await tonemapChain()] : []),
    "scale=360:-2:flags=lanczos",
    "format=yuvj420p",
  ].join(",");
  const shot = (ss: number) =>
    execFileP(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(ss), "-i", masterPath, "-frames:v", "1", "-vf", vf, "-q:v", "4", out],
      { timeout: 60_000 }
    );
  try {
    await shot(at);
    return out;
  } catch {
    // Короткие и «кривые» файлы иногда не отдают кадр по перемотке — берём первый.
    try {
      await shot(0);
      return out;
    } catch {
      return null;
    }
  }
}

/**
 * Отрисовать кадр-обложку из мастер-файла в JPEG. Берём именно исходник:
 * он в полном качестве, в отличие от того, что успел декодировать браузер.
 */
export async function renderCoverFrame(
  masterPath: string,
  ms: number,
  maxWidth = 1280
): Promise<Buffer | null> {
  const info = await probeMedia(masterPath).catch(() => null);
  // Запрошенный кадр может оказаться за концом ролика (например, обложку
  // выбрали до замены файла) — тогда берём последнюю секунду, а не пустоту.
  const durationMs = (info?.duration ?? 0) * 1000;
  const at = durationMs > 0 ? Math.min(Math.max(0, ms), Math.max(0, durationMs - 1000)) : Math.max(0, ms);
  const vf = [
    ...(info?.video?.hdr ? [await tonemapChain()] : []),
    // min(): кадр уменьшаем, но никогда не растягиваем — растянутый только мылит.
    `scale='min(${maxWidth},iw)':-2:flags=lanczos`,
    "format=yuvj420p",
  ].join(",");
  try {
    const { stdout } = await execFileP(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error",
        // Перемотка ДО -i: ffmpeg не декодирует файл с начала.
        "-ss", String(at / 1000),
        "-i", masterPath,
        "-frames:v", "1", "-vf", vf, "-q:v", "3",
        "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1",
      ],
      { timeout: 60_000, maxBuffer: 1 << 24, encoding: "buffer" }
    );
    return stdout.length > 0 ? (stdout as Buffer) : null;
  } catch {
    return null;
  }
}

/**
 * Привести загруженную обложку к JPEG рядом с мастер-файлом.
 * YouTube не принимает превью тяжелее 2 МБ, поэтому ужимаем с запасом.
 * Возвращает путь к готовому файлу или null, если картинку прочитать не вышло.
 */
export async function normalizeCoverImage(
  sourcePath: string,
  masterPath: string
): Promise<string | null> {
  const out = masterPath.replace(/\.[^./]+$/, "") + ".cover.jpg";
  for (const quality of [3, 6, 9]) {
    try {
      await execFileP(
        "ffmpeg",
        [
          "-hide_banner", "-loglevel", "error", "-y",
          "-i", sourcePath,
          "-vf", "scale='min(1920,iw)':-2:flags=lanczos,format=yuvj420p",
          "-frames:v", "1", "-q:v", String(quality),
          out,
        ],
        { timeout: 60_000 }
      );
      const { size } = await stat(out);
      if (size <= 2 * 1024 * 1024) return out;
    } catch {
      return null;
    }
  }
  // Даже на низком качестве не влезли — отдаём как есть, YouTube откажет мягко.
  return out;
}
