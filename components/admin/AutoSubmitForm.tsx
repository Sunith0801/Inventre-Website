"use client";
import { useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * GET-form wrapper that submits on every filter change — no Apply
 * button. Text inputs (`<input type="text">`, search inputs) debounce
 * for ~350ms so each keystroke doesn't fire a navigation; selects
 * submit immediately.
 *
 * Navigation is CLIENT-SIDE (router.push, scroll preserved), not a native
 * GET form submit. A native submit triggers a full document reload, which
 * flashes the page and — worse for a search box — re-mounts the input on
 * every debounce flush, stealing focus and resetting the caret mid-typing.
 * router.push does a soft RSC re-render instead: the form/input stay
 * mounted (uncontrolled DOM value persists), so the user keeps typing
 * uninterrupted while the table below refreshes.
 *
 * Date inputs never auto-fire on a timer: native pickers keep focus on
 * the input after a pick, so a debounce would reload mid-range (after the
 * "from" date, before "to"). Instead a date change just marks the submit
 * pending; it flushes once when focus leaves the form (handleBlur) or on
 * Enter — so a from/to range refreshes the table exactly once, after both
 * ends are chosen.
 *
 * Use anywhere we want the same instant-filter UX: orders, students,
 * catalog browsing. The URL still carries the filters as query params so
 * server components re-render with the new searchParams — no client-side
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
  const router = useRouter();
  const formRef = useRef<HTMLFormElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True when a filter changed but the submit is debounced/held — used to
  // flush on focus-out so a deferred change is never silently dropped.
  const pendingRef = useRef(false);

  const submitNow = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = false;
    const form = formRef.current;
    if (!form) return;
    // Serialize the form's current values into query params (skipping
    // empties so the URL stays clean) and navigate client-side.
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(form).entries()) {
      const s = typeof value === "string" ? value : "";
      if (s.trim() !== "") params.append(key, s);
    }
    const qs = params.toString();
    router.push(qs ? `${action}?${qs}` : action, { scroll: false });
  };
  const submitDebounced = (ms: number) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    pendingRef.current = true;
    timerRef.current = setTimeout(submitNow, ms);
  };
  // Mark a change as pending WITHOUT arming a timer — the submit flushes on
  // focus-out (handleBlur) or Enter (onSubmit). Used for date inputs so a
  // range refreshes once, after both ends are chosen, instead of reloading
  // the moment the first date is picked.
  const markPending = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingRef.current = true;
  };

  const handleInput: React.FormEventHandler<HTMLFormElement> = (e) => {
    const target = e.target as HTMLInputElement | HTMLSelectElement;
    // Selects / checkbox / radio fire change synchronously with a final
    // value and should submit immediately; free-text inputs debounce so
    // each keystroke doesn't trigger a navigation.
    const tag = target.tagName.toLowerCase();
    const type = "type" in target ? target.type : "";
    if (tag === "select" || type === "checkbox" || type === "radio") {
      submitNow();
    } else if (type === "date") {
      // Native date pickers keep focus on the input after a pick, so a
      // debounce timer would fire mid-range (after "from", before "to").
      // Hold instead and let focus-out / Enter flush a single refresh.
      markPending();
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
      onSubmit={(e) => {
        // Enter key: prevent the native full-page GET reload and navigate
        // client-side instead (submitNow clears any pending debounce too).
        e.preventDefault();
        submitNow();
      }}
    >
      {children}
    </form>
  );
}
