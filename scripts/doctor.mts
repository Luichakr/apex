/**
 * Самопроверка установки APEX. Запуск:  npm run doctor
 *
 * Ничего не меняет и никуда не публикует: только читает настройки, проверяет
 * связь с базой, Redis и ffmpeg и пробует открыть сайт по публичному адресу.
 * У каждой находки написано, что сделать. Код выхода: 1 — есть поломка.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { access, constants, mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { statfs } from "node:fs";
import { join } from "node:path";

const execFileP = promisify(execFile);

type Status = "ok" | "warn" | "fail" | "skip";
type Check = { label: string; status: Status; detail?: string; fix?: string };

const checks: Check[] = [];
const add = (c: Check) => checks.push(c);

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
};

const PLACEHOLDERS = [
  "change-me",
  "changeme",
  "your-domain",
  "example.com",
  "apex.example.com",
  "replace",
  "xxx",
];

function looksLikePlaceholder(v: string): boolean {
  const low = v.toLowerCase();
  return PLACEHOLDERS.some((p) => low.includes(p));
}

// --- 1. Окружение ----------------------------------------------------------

function checkNode() {
  const major = Number(process.versions.node.split(".")[0]);
  add({
    label: `Node.js ${process.versions.node}`,
    status: major >= 20 ? "ok" : "fail",
    detail: major >= 20 ? undefined : "нужна версия 20 или новее",
    fix: major >= 20 ? undefined : "Установите Node.js 20+ с nodejs.org",
  });
}

function checkSecrets() {
  const required = ["APP_URL", "DATABASE_URL", "REDIS_URL", "SESSION_SECRET", "TOKEN_ENCRYPTION_KEY", "MAGIC_LINK_SECRET"];
  for (const key of required) {
    const v = process.env[key] ?? "";
    if (!v) {
      add({
        label: key,
        status: "fail",
        detail: "не задан в .env",
        fix: key.endsWith("SECRET") || key.endsWith("KEY")
          ? "npm run keygen — и вставьте значение в .env"
          : `Добавьте ${key} в .env (образец — в .env.example)`,
      });
      continue;
    }
    if (looksLikePlaceholder(v)) {
      add({ label: key, status: "fail", detail: "осталось значение-заглушка из примера", fix: `Замените ${key} в .env на настоящее значение` });
      continue;
    }
    // Ключи должны быть достаточной длины (base64 от 32 байт).
    if (key.endsWith("SECRET") || key === "TOKEN_ENCRYPTION_KEY") {
      const bytes = Buffer.from(v, "base64").length;
      add({
        label: key,
        status: bytes >= 32 ? "ok" : "fail",
        detail: bytes >= 32 ? `${bytes} байт` : `всего ${bytes} байт, нужно 32`,
        fix: bytes >= 32 ? undefined : "npm run keygen — и вставьте новое значение в .env",
      });
      continue;
    }
    add({ label: key, status: "ok", detail: key === "APP_URL" ? v : "задан" });
  }

  const owner = process.env.OWNER_EMAIL;
  add({
    label: "OWNER_EMAIL",
    status: owner ? "ok" : "warn",
    detail: owner ?? "не задан — некому быть владельцем",
    fix: owner ? undefined : "Добавьте OWNER_EMAIL=ваша@почта в .env",
  });

  const smtp = process.env.SMTP_HOST;
  const logLinks = process.env.LOG_MAGIC_LINKS === "1";
  add({
    label: "Почта для входа (SMTP)",
    status: smtp ? "ok" : logLinks ? "warn" : "fail",
    detail: smtp
      ? smtp
      : logLinks
        ? "не настроена: ссылки входа печатаются в лог сервера"
        : "не настроена — друзья не смогут войти",
    fix: smtp ? undefined : "Заполните SMTP_* в .env (или оставьте LOG_MAGIC_LINKS=1 для личного теста)",
  });
}

function checkProviders() {
  const nets: [string, string[]][] = [
    ["YouTube", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]],
    ["Instagram", ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"]],
    ["TikTok", ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"]],
  ];
  const ready = nets.filter(([, keys]) => keys.every((k) => process.env[k]));
  for (const [name, keys] of nets) {
    const ok = keys.every((k) => process.env[k]);
    add({
      label: `Ключи ${name}`,
      status: ok ? "ok" : "warn",
      detail: ok ? "заданы" : "не заданы — сеть не будет предлагаться",
      fix: ok ? undefined : `Заполните ${keys.join(" и ")} в .env (инструкция — docs/)`,
    });
  }
  if (ready.length === 0) {
    add({ label: "Хотя бы одна сеть", status: "fail", detail: "не настроена ни одна площадка", fix: "Пройдите чек-листы в docs/ и заполните ключи в .env" });
  }
}

// --- 2. Внешние службы -----------------------------------------------------

async function checkFfmpeg() {
  for (const bin of ["ffmpeg", "ffprobe"]) {
    try {
      const { stdout } = await execFileP(bin, ["-version"], { timeout: 10_000 });
      add({ label: bin, status: "ok", detail: stdout.split("\n")[0].slice(0, 60) });
    } catch {
      add({
        label: bin,
        status: "fail",
        detail: "не найден — видео не получится подготовить",
        fix: "macOS: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg",
      });
      return;
    }
  }
  try {
    const { stdout } = await execFileP("ffmpeg", ["-hide_banner", "-encoders"], { maxBuffer: 1 << 22 });
    for (const enc of ["libx264", "aac"]) {
      add({
        label: `Кодировщик ${enc}`,
        status: stdout.includes(` ${enc} `) ? "ok" : "fail",
        detail: stdout.includes(` ${enc} `) ? "есть" : "отсутствует в этой сборке ffmpeg",
        fix: stdout.includes(` ${enc} `) ? undefined : "Поставьте полную сборку ffmpeg (brew install ffmpeg)",
      });
    }
  } catch {
    /* уже сообщили выше */
  }
}

async function checkDatabase() {
  try {
    const { prisma } = await import("../src/lib/db");
    const [{ count }] = await prisma.$queryRaw<{ count: bigint }[]>`select count(*)::bigint as count from "User"`;
    add({ label: "База данных", status: "ok", detail: `подключение есть, пользователей: ${count}` });

    const stuck = await prisma.postTarget.count({ where: { status: { in: ["QUEUED", "PROCESSING"] } } });
    const failed = await prisma.postTarget.count({ where: { status: "FAILED" } });
    add({
      label: "Публикации в работе",
      status: "ok",
      detail: `в очереди или обрабатываются: ${stuck}, с ошибкой: ${failed}`,
    });

    // Аккаунты, которым нужен повторный вход.
    const broken = await prisma.socialAccount.findMany({
      where: { needsReconnect: true },
      select: { provider: true, displayName: true, reconnectReason: true },
    });
    for (const a of broken) {
      add({
        label: `Доступ ${a.provider}${a.displayName ? ` (${a.displayName})` : ""}`,
        status: "fail",
        detail: a.reconnectReason ?? "площадка отозвала доступ",
        fix: "Откройте страницу «Аккаунты» и подключите эту сеть заново",
      });
    }

    // Доступы, которые скоро истекут.
    const soon = new Date(Date.now() + 7 * 86_400_000);
    const expiring = (
      await prisma.socialAccount.findMany({
        where: { tokenExpiresAt: { not: null, lt: soon }, needsReconnect: false },
        select: { provider: true, displayName: true, tokenExpiresAt: true, refreshTokenEnc: true },
      })
    ).filter((a) => !a.refreshTokenEnc); // с refresh-токеном доступ продлевается сам
    if (expiring.length === 0) {
      add({ label: "Доступы к сетям", status: "ok", detail: "ничего не истекает в ближайшую неделю" });
    } else {
      for (const a of expiring) {
        const expired = a.tokenExpiresAt!.getTime() < Date.now();
        add({
          label: `Доступ ${a.provider}${a.displayName ? ` (${a.displayName})` : ""}`,
          status: expired ? "fail" : "warn",
          detail: expired
            ? `истёк ${a.tokenExpiresAt!.toLocaleDateString("ru-RU")}`
            : `истекает ${a.tokenExpiresAt!.toLocaleDateString("ru-RU")}`,
          fix: "Откройте страницу «Аккаунты» и подключите сеть заново",
        });
      }
    }
    await prisma.$disconnect();
  } catch (e) {
    add({
      label: "База данных",
      status: "fail",
      detail: msg(e),
      fix: "Проверьте DATABASE_URL в .env и что PostgreSQL запущен (docker compose up -d postgres)",
    });
  }
}

async function checkRedisAndWorker() {
  try {
    const { connection, workerHealth, publishQueue } = await import("../src/lib/redis");
    await connection.ping();
    add({ label: "Redis", status: "ok", detail: "отвечает" });

    const counts = await publishQueue.getJobCounts("waiting", "active", "delayed", "failed");
    add({
      label: "Очередь публикаций",
      status: "ok",
      detail: `ждут: ${counts.waiting}, в работе: ${counts.active}, отложены: ${counts.delayed}, упали: ${counts.failed}`,
    });

    const h = await workerHealth();
    add({
      label: "Воркер (публикует видео)",
      status: h.alive ? "ok" : "fail",
      detail: h.alive
        ? `работает, отметка ${h.lastSeen!.toLocaleTimeString("ru-RU")}`
        : h.lastSeen
          ? `молчит с ${h.lastSeen.toLocaleString("ru-RU")}`
          : "ни разу не запускался",
      fix: h.alive ? undefined : "Запустите воркер: npm run worker (или docker compose up -d worker)",
    });
    connection.disconnect();
  } catch (e) {
    add({
      label: "Redis",
      status: "fail",
      detail: msg(e),
      fix: "Проверьте REDIS_URL в .env и что Redis запущен (docker compose up -d redis)",
    });
  }
}

async function checkMediaDir() {
  const dir = process.env.MEDIA_DIR || join(process.cwd(), "media");
  try {
    await mkdir(dir, { recursive: true });
    await access(dir, constants.W_OK);
    const probe = join(dir, `.doctor-${Date.now()}`);
    await writeFile(probe, "x");
    await unlink(probe);
    add({ label: "Папка для видео", status: "ok", detail: dir });
  } catch (e) {
    add({ label: "Папка для видео", status: "fail", detail: `${dir}: ${msg(e)}`, fix: "Дайте права на запись в эту папку" });
    return;
  }
  // Свободное место: одно 4K-видео плюс его версии легко занимают несколько ГБ.
  const free = await new Promise<number>((res) =>
    statfs(dir, (err, s) => res(err ? NaN : Number(s.bavail) * Number(s.bsize)))
  );
  if (Number.isFinite(free)) {
    const gb = free / 1024 ** 3;
    add({
      label: "Свободное место",
      status: gb > 20 ? "ok" : gb > 5 ? "warn" : "fail",
      detail: `${gb.toFixed(1)} ГБ`,
      fix: gb > 20 ? undefined : "Освободите место: одно 4K-видео с версиями занимает несколько ГБ",
    });
  }
}

async function checkPublicUrl() {
  const url = process.env.APP_URL;
  if (!url) return;
  // Instagram сам скачивает видео по этому адресу — он обязан открываться извне.
  try {
    const res = await fetch(new URL("/api/health", url), {
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean };
    add({
      label: "Сайт по публичному адресу",
      status: res.ok && body.ok ? "ok" : "fail",
      detail: res.ok && body.ok ? url : `${url} ответил ${res.status}`,
      fix: res.ok && body.ok ? undefined : "Проверьте, что сервер запущен и APP_URL совпадает с реальным адресом: по нему Instagram забирает видео",
    });
    if (!url.startsWith("https://")) {
      add({
        label: "HTTPS",
        status: "fail",
        detail: "APP_URL без https",
        fix: "Площадки требуют https. Поставьте домен с сертификатом (Caddy выдаёт его сам)",
      });
    }
  } catch (e) {
    add({
      label: "Сайт по публичному адресу",
      status: "fail",
      detail: `${url}: ${msg(e)}`,
      fix: "Запустите сервер (npm run start) и проверьте APP_URL: по этому адресу Instagram скачивает видео",
    });
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0].slice(0, 120) : String(e);
}

// --- Вывод -----------------------------------------------------------------

async function main() {
  console.log(C.bold("\nAPEX — проверка установки\n"));
  checkNode();
  checkSecrets();
  checkProviders();
  await checkFfmpeg();
  await checkMediaDir();
  await checkDatabase();
  await checkRedisAndWorker();
  await checkPublicUrl();

  const icon: Record<Status, string> = {
    ok: C.green("✓"),
    warn: C.yellow("!"),
    fail: C.red("✗"),
    skip: C.dim("·"),
  };
  for (const c of checks) {
    console.log(`${icon[c.status]} ${c.label}${c.detail ? C.dim(` — ${c.detail}`) : ""}`);
    if (c.fix && c.status !== "ok") console.log(`    ${C.dim("→")} ${c.fix}`);
  }

  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  console.log(
    "\n" +
      (fails
        ? C.red(`Поломок: ${fails}`) + (warns ? C.yellow(`, предупреждений: ${warns}`) : "")
        : warns
          ? C.yellow(`Всё работает, предупреждений: ${warns}`)
          : C.green("Всё в порядке.")) +
      "\n"
  );
  process.exit(fails ? 1 : 0);
}

await main();
