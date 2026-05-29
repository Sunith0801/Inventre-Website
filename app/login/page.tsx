import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/LoginForm";
import { AuthBrandPanel } from "@/components/auth/AuthBrandPanel";
import { getCurrentUser } from "@/lib/session";
import { resolveMedia } from "@/lib/repos/media";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in? skip the gate.
  const me = await getCurrentUser();
  if (me?.kind === "parent") redirect("/shop");

  const [brandImageUrl, brandLogoUrl] = await Promise.all([
    resolveMedia("media.login.brand_panel.image"),
    resolveMedia("media.login.brand_panel.logo"),
  ]);

  return (
    <main className="min-h-screen flex bg-cream">
      <div className="flex-1 flex flex-col">
        <div className="flex-1 grid place-items-center px-5 lg:px-10 py-8">
          <LoginForm />
        </div>

        <div className="px-5 lg:px-10 py-5 text-[11px] text-ink-400 flex items-center justify-between">
          <span>© {new Date().getFullYear()} Inventre</span>
          <div className="flex gap-4">
            <a href="#" className="hover:text-ink-700">Privacy</a>
            <a href="#" className="hover:text-ink-700">Terms</a>
          </div>
        </div>
      </div>

      <AuthBrandPanel imageUrl={brandImageUrl} logoUrl={brandLogoUrl} />
    </main>
  );
}
