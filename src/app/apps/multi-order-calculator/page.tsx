import { redirect } from "next/navigation";

// The Multi-Order Calculator is now the Calculator section of Trading Studio.
// The route stays alive so old links land in the right place.
export default function Page() {
  redirect("/apps/trading-studio?section=calculator");
}
