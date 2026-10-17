"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Тихо обновляет страницу раз в N секунд, чтобы статусы публикаций были свежими. */
export default function AutoRefresh({ seconds = 5 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
