/**
 * Письмо о неудачных публикациях.
 *
 * Отложенная публикация может упасть ночью, и без письма об этом никто не
 * узнает. Шлём не чаще раза в сутки и только про окончательные неудачи —
 * то, что ещё повторяется, не тревожит зря.
 */
import { prisma } from "./db";
import { getEnv } from "./env";
import { sendMail } from "./mailer";
import { PROVIDER_LABEL } from "./limits";

const WINDOW_MS = 24 * 60 * 60_000;

export async function sendFailureDigests(): Promise<void> {
  const env = getEnv();
  if (!env.SMTP_HOST) return; // почта не настроена — тихо выходим

  const users = await prisma.user.findMany({
    where: { posts: { some: { targets: { some: { status: "FAILED" } } } } },
    select: { id: true, email: true, failureNotifiedAt: true },
  });

  for (const user of users) {
    const since = user.failureNotifiedAt;
    if (since && Date.now() - since.getTime() < WINDOW_MS) continue;

    const failures = await prisma.postTarget.findMany({
      where: {
        status: "FAILED",
        post: { userId: user.id },
        ...(since ? { updatedAt: { gt: since } } : {}),
      },
      include: { post: { select: { caption: true, mediaName: true } } },
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    if (failures.length === 0) continue;

    const lines = failures.map((f) => {
      const what = f.post.caption?.split("\n")[0]?.slice(0, 60) || f.post.mediaName || "видео";
      return `• ${PROVIDER_LABEL[f.provider]} — ${what}\n  Причина: ${f.error ?? "не указана"}`;
    });
    const url = new URL("/posts", env.APP_URL).toString();

    await sendMail({
      to: user.email,
      subject:
        failures.length === 1
          ? `${env.APP_NAME}: публикация не прошла`
          : `${env.APP_NAME}: не прошло публикаций — ${failures.length}`,
      text: `Не удалось опубликовать:\n\n${lines.join("\n\n")}\n\nПовторить можно здесь: ${url}`,
      html:
        `<p>Не удалось опубликовать:</p><ul>${failures
          .map(
            (f) =>
              `<li><b>${PROVIDER_LABEL[f.provider]}</b> — ${escapeHtml(
                f.post.caption?.split("\n")[0]?.slice(0, 60) || f.post.mediaName || "видео"
              )}<br><span style="color:#666">${escapeHtml(f.error ?? "причина не указана")}</span></li>`
          )
          .join("")}</ul><p><a href="${url}">Открыть публикации и повторить</a></p>`,
    }).catch((e) => {
      console.error("[notify] письмо не отправлено:", e instanceof Error ? e.message : e);
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { failureNotifiedAt: new Date() },
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
