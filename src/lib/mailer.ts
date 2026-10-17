/**
 * Отправка писем (ссылка входа).
 * Если SMTP не настроен — ссылка печатается в лог сервера, но только при
 * LOG_MAGIC_LINKS=1 или в режиме разработки (чтобы на боевом сервере
 * ссылки входа не оседали в логах).
 */
import nodemailer from "nodemailer";
import { getEnv } from "./env";

type Mail = { to: string; subject: string; text: string; html: string };

/** Отправить письмо. Без настроенного SMTP — не делает ничего. */
export async function sendMail(mail: Mail): Promise<void> {
  const env = getEnv();
  if (!env.SMTP_HOST) return;
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });
  await transport.sendMail({
    from: env.SMTP_FROM || `${env.APP_NAME} <no-reply@localhost>`,
    ...mail,
  });
}

export async function sendMagicLink(email: string, url: string): Promise<void> {
  const env = getEnv();

  if (!env.SMTP_HOST) {
    if (env.NODE_ENV === "production" && env.LOG_MAGIC_LINKS !== "1") {
      throw new Error("Почта (SMTP) не настроена — письмо со ссылкой входа отправить нельзя");
    }
    console.log("\n==============================================");
    console.log(`[mailer] SMTP не настроен. Ссылка входа для ${email}:`);
    console.log(url);
    console.log("==============================================\n");
    return;
  }

  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: (env.SMTP_PORT ?? 587) === 465,
    auth:
      env.SMTP_USER && env.SMTP_PASSWORD
        ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
        : undefined,
  });

  await transport.sendMail({
    from: env.SMTP_FROM || `${env.APP_NAME} <no-reply@localhost>`,
    to: email,
    subject: `Вход в ${env.APP_NAME}`,
    text: `Чтобы войти в ${env.APP_NAME}, перейдите по ссылке (действует 15 минут):\n\n${url}\n\nЕсли вы не запрашивали вход — просто игнорируйте это письмо.`,
    html: `<p>Чтобы войти в <b>${env.APP_NAME}</b>, нажмите кнопку (ссылка действует 15 минут):</p>
<p><a href="${url}" style="display:inline-block;background:#010205;color:#fff;padding:12px 22px;border-radius:4px;font-family:Arial,sans-serif;text-decoration:none">Войти</a></p>
<p>Или скопируйте ссылку: <br>${url}</p>
<p style="color:#888">Если вы не запрашивали вход — просто игнорируйте это письмо.</p>`,
  });
}
