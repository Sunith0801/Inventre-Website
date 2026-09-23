/**
 * Renders a consent-checkbox label, turning the literal words
 * "Privacy Policy" into a link to /privacy (new tab). Presentation only —
 * the label text itself still comes from TC_REQUIRED_CHECKS.
 */
const NEEDLE = "Privacy Policy";

export function PrivacyLinkedLabel({ text }: { text: string }) {
  const at = text.indexOf(NEEDLE);
  if (at < 0) return <span>{text}</span>;
  return (
    <span>
      {text.slice(0, at)}
      <a
        href="/privacy"
        target="_blank"
        rel="noopener noreferrer"
        className="underline"
        onClick={(e) => e.stopPropagation()}
      >
        {NEEDLE}
      </a>
      {text.slice(at + NEEDLE.length)}
    </span>
  );
}
