"use client";
import { useRef } from "react";

/**
 * GET-form wrapper that submits on every filter change — no Apply
 * button. Text inputs (`<input type="text">`, search inputs) debounce
 * for ~350ms so each keystroke doesn't fire a navigation; selects
 * submit immediately.
 *
 * Date inputs are special-cased twice over:
 *  - browsers fire `input` once per *segment* (day / month / year)
 *    while a date is typed, so they debounce rather than submit
 *    instantly;
 *  - a pending submit is held while focus is still inside the form,
 *    so picking a "from" date doesn't reload the page out from under
 *    the "to" picker — the submit flushes when the user edits the next
 *    field (rescheduled), or when focus leaves the form entirely.
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
  // True when a filter changed but the submit is debounced/held — used to
  // flush on focus-out so a deferred change is never silently dropped.
  const pendingRef = useRef(false);

  const submitNow = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = false;
    formRef.current?.requestSubmit();
  };
  const submitDebounced = (ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = true;
    timerRef.current = setTimeout(submitNow, ms);
  };

  const handleInput: React.FormEventHandler<HTMLFormElement> = (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    // Selects / checkbox / radio fire change synchronously with a final
    // value and should submit immediately; date inputs and free-text
    // inputs debounce so each segment / keystroke doesn't trigger a
    // navigation.
    const tag = target.tagName.toLowerCase();
    const type = "type" in target ? target.type : "";
    if (tag === "select" || type === "checkbox" || type === "radio") {
      submitNow();
    } else if (type === "date") {
      submitDebounced(Math.max(debounceMs, 800));
    } else {
      submitDebounced(debounceMs);
    }
  };

  // React ≥17 attaches onFocus/onBlur via native focusin/focusout, so
  // these bubble up from every control in the form.
  const handleFocus: React.FocusEventHandler<HTMLFormElement> = () => {
    // Focus moved to (another) field while a submit is pending: the user
    // is still composing the filter set. Pause the timer; the submit
    // re-arms on their next input, or flushes on focus-out below.
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const handleBlur: React.FocusEventHandler<HTMLFormElement> = (e) => {
    const next = e.relatedTarget as Node | null;
    const leftForm = !next || !formRef.current?.contains(next);
    if (pendingRef.current && leftForm) submitNow();
  };

  return (
    <form
      ref={formRef}
      method="GET"
      action={action}
      onInput={handleInput}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onSubmit={() => {
        // Cancel any pending debounce so we don't double-submit when the
        // user hits Enter mid-typing.
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        pendingRef.current = false;
      }}
    >
      {children}
    </form>
  );
}
