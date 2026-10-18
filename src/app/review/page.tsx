import { redirect } from "next/navigation";

// "My websites" is the Client tab of the Client Review page now.
export default function Page() {
  redirect("/apps/client-review");
}
