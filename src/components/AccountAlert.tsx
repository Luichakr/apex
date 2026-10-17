import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { PROVIDER_LABEL } from "@/lib/limits";
import Icon from "./Icon";

/**
 * Полоса на всех страницах, если площадка отозвала доступ. Без неё о проблеме
 * узнают в момент публикации — то есть всегда слишком поздно.
 */
export default async function AccountAlert() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return null;
  const broken = await prisma.socialAccount
    .findMany({
      where: { userId: user.id, needsReconnect: true },
      select: { id: true, provider: true, displayName: true },
    })
    .catch(() => []);
  if (broken.length === 0) return null;

  return (
    <div className="alertbar" role="alert">
      <div className="grid">
        <div className="z-basic alertbar__in">
          <Icon name="alert" />
          <span>
            {broken.length === 1
              ? `${PROVIDER_LABEL[broken[0].provider]}${broken[0].displayName ? ` (${broken[0].displayName})` : ""} требует повторного входа — публикации в эту сеть не пройдут.`
              : `Сетей, требующих повторного входа: ${broken.length} — ${broken
                  .map((a) => PROVIDER_LABEL[a.provider])
                  .join(", ")}.`}
          </span>
          <Link href="/accounts" className="link-arrow">
            <Icon name="arrow" /> Переподключить
          </Link>
        </div>
      </div>
    </div>
  );
}
