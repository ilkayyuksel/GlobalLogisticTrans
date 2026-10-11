import { redirect } from "next/navigation";

/**
 * Drivers are managed on the fleet page now, beside the vehicles and the
 * links between them. The old address keeps working for bookmarks.
 */
export default function DriversPage() {
  redirect("/vehicles#chauffeurs");
}
