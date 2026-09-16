import { redirect } from "next/navigation";

/**
 * The type chooser moved to /admin/products/new so there is exactly one
 * way into product creation. The Bookkit and Uniform builders under this
 * segment stay where they are and are linked from there.
 */
export default function BuildWizardRedirect() {
  redirect("/admin/products/new");
}
