import { redirect } from "next/navigation";

/**
 * The product opens on the Dashboard, which is its landing page.
 */
export default function HomePage() {
  redirect("/dashboard");
}
