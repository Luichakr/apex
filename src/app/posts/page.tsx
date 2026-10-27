import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser, dataOwnerId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import Icon from "@/components/Icon";
import PostCard from "@/components/PostCard";
import AutoRefresh from "./auto-refresh";

export const metadata: Metadata = { title: "Публикации" };
export const dynamic = "force-dynamic";

const RETRY_MSG: Record<string, { kind: "ok" | "error" | "info"; text: string }> = {
  ok: { kind: "ok", text: "Повторная публикация поставлена в очередь." },
  no_account: { kind: "error", text: "Аккаунт этой сети отключён — подключите его заново." },
  no_media: { kind: "error", text: "Видео уже удалено по сроку хранения — создайте новый пост." },
  skip: { kind: "info", text: "Эта публикация уже не в статусе ошибки." },
  viewer: { kind: "error", text: "Наблюдатель не может менять публикации." },
};

const DELETE_MSG: Record<string, { kind: "ok" | "error" | "info"; text: string }> = {
  ok: { kind: "ok", text: "Пост убран из APX. В самих сетях он остался — удалить его можно там." },
  canceled: { kind: "ok", text: "Запланированная публикация отменена." },
  busy: { kind: "error", text: "Видео сейчас загружается в сеть — удалить можно, когда загрузка закончится." },
  missing: { kind: "info", text: "Этого поста уже нет." },
};

export default async function PostsPage({
  searchParams,
}: {
  searchParams: Promise<{ retry?: string; created?: string; deleted?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const sp = await searchParams;

  const ownerId = await dataOwnerId(user);
  const posts = await prisma.post.findMany({
    where: { userId: ownerId },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      targets: {
        orderBy: { provider: "asc" },
        include: { metrics: { orderBy: { fetchedAt: "desc" }, take: 1 } },
      },
    },
  });
  const pending = posts.some((p) => p.status === "PUBLISHING");
  const retry = sp.retry ? RETRY_MSG[sp.retry] : sp.deleted ? DELETE_MSG[sp.deleted] : null;

  return (
    <main>
      {pending && <AutoRefresh seconds={4} />}
      <div className="grid page-head">
        <div className="z-basic between" style={{ alignItems: "flex-end" }}>
          <div>
            <h1>Публикации</h1>
            <p className="lead">Всё, что вы отправили через APX: статус по каждой сети и охваты.</p>
          </div>
          <nav className="tabs" aria-label="Вид">
            <Link href="/posts" aria-current="page">Список</Link>
            <Link href="/calendar">Календарь</Link>
          </nav>
        </div>
      </div>
      <div className="grid">
        <div className="z-basic stack">
          {sp.created && (
            <div className="msg msg--ok" role="status">
              <Icon name="check" />
              <div className="msg__body">Видео загружено. Готовим версии под каждую сеть — статус обновляется сам.</div>
            </div>
          )}
          {retry && (
            <div className={`msg ${retry.kind === "ok" ? "msg--ok" : retry.kind === "error" ? "msg--error" : ""}`} role="status">
              <Icon name={retry.kind === "error" ? "alert" : "info"} />
              <div className="msg__body">{retry.text}</div>
            </div>
          )}
          {posts.length === 0 ? (
            <div className="panel stack-sm">
              <h2 style={{ fontSize: "var(--fs-lg)" }}>Пока пусто</h2>
              <p className="muted">Загрузите первое видео — оно уйдёт во все подключённые сети.</p>
              <div><Link className="btn" href="/compose">Создать пост</Link></div>
            </div>
          ) : (
            posts.map((post) => <PostCard key={post.id} post={post} canEdit={user.role !== "VIEWER"} />)
          )}
        </div>
      </div>
    </main>
  );
}
