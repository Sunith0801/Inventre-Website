/**
 * /admin/sections is pure navigation: each landing page lists only the
 * modules the current admin may open (`visibleItems`) and every module link
 * lands behind that module's own SectionGate. There is no single permission
 * to gate the section itself on, so this layout deliberately passes through.
 */
export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
