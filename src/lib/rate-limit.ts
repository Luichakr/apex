/** Простое ограничение частоты запросов на Redis (фиксированное окно). */
import { connection } from "./redis";

/** true — запрос разрешён; false — лимит исчерпан. */
export async function rateLimit(key: string, limit: number, windowSec: number): Promise<boolean> {
  try {
    const k = `rl:${key}`;
    const n = await connection.incr(k);
    if (n === 1) await connection.expire(k, windowSec);
    return n <= limit;
  } catch {
    return true; // Redis недоступен — не блокируем вход
  }
}
