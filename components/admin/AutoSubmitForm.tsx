"use client";
import { useRef } from "react";

/**
 * GET-form wrapper that submits on every filter change — no Apply
 * button. Text inputs (`<input type="text">`, search inputs) debounce
 * for ~350ms so each keystroke doesn't fire a navigation; selects and
 * date pickers submit immediately.
 *
 * Use anywhere we want the same instant-filter UX: orders, students,
 * catalog browsing. The form still submits via standard GET so server
 * components re-render with the new searchParams — no client-side
 * state to keep in sync.
 */
export function AutoSubmitForm({
  action,
  children,
  debounceMs = 350,
}: {
  action: string;
  children: React.ReactNode;
  debounceMs?: number;
}) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submitNow = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    formRef.current?.requestSubmit();
  };
  const submitDebounced = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(submitNow, debounceMs);
  };

  const handleInput: React.FormEventHandler<HTMLFormElement> = (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    // Selects / date / checkbox / radio fire change synchronously and
    // should submit immediately; free-text inputs debounce so each
    // keystroke doesn't trigger a navigation.
    const tag = target.tagName.toLowerCase();
    const type = "type" in target ? target.type : "";
    if (tag === "select" || type === "date" || type === "checkbox" || type === "radio") {
      submitNow();
    } else {
      submitDebounced();
    }
  };

  return (
    <form
      ref={formRef}
      method="GET"
      action={action}
      onInput={handleInput}
      onSubmit={(e) => {
        // Cancel any pending debounce so we don't double-submit when the
        // user hits Enter mid-typing.
        if (timerRef.current) clearTimeout(timerRef.current);
        // Let the native GET submit proceed.
        void e;
      }}
    >
      {children}
    </form>
  );
}
