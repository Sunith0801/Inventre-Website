import { redirect } from "next/navigation";

// The school-wise BOM Master (/admin/boms/new) supersedes the old bundle
// builder — it has the school + grade dropdowns and type-ahead item search.
export default function NewBundleRedirect() {
  redirect("/admin/boms/new");
}
