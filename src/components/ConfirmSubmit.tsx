"use client";

/** Кнопка формы, которая сначала спрашивает подтверждение. */
export default function ConfirmSubmit({
  question,
  className,
  children,
}: {
  question: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="submit"
      className={className}
      onClick={(e) => {
        if (!window.confirm(question)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
