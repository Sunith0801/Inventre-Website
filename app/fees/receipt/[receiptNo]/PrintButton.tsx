"use client";

/** Print-to-PDF is the export path — @media print reduces the page to the
 *  document itself, so the browser's own PDF writer produces the file. */
export default function PrintButton() {
  return (
    <button className="fx-page rc-print" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  );
}
