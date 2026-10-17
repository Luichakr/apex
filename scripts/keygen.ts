/**
 * Генерация секретных ключей для .env.
 * Запуск: npm run keygen
 * Скопируйте выведенные строки в ваш .env (замените пустые значения).
 */
import { randomBytes } from "node:crypto";

function key(): string {
  return randomBytes(32).toString("base64");
}

console.log("\n# Скопируйте эти строки в ваш .env:\n");
console.log(`TOKEN_ENCRYPTION_KEY=${key()}`);
console.log(`SESSION_SECRET=${key()}`);
console.log(`MAGIC_LINK_SECRET=${key()}`);
console.log(
  "\n# ВНИМАНИЕ: TOKEN_ENCRYPTION_KEY нельзя терять и нельзя менять после\n" +
    "# подключения аккаунтов — иначе сохранённые токены станет не расшифровать.\n"
);
