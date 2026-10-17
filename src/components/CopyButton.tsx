"use client";

import { useState } from "react";
import Icon from "./Icon";

export default function CopyButton({ text, label = "Скопировать" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    setDone(true);
    setTimeout(() => setDone(false), 2000);
  }
  return (
    <button type="button" className="btn btn--tool btn--sm" onClick={copy} style={{ justifySelf: "start" }}>
      <Icon name={done ? "check" : "copy"} /> {done ? "Скопировано" : label}
    </button>
  );
}
