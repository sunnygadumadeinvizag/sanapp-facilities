import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

// Unmatched URLs land here; calling notFound() renders the app's
// custom not-found page (with header/footer) inside the root layout.
export default function CatchAllNotFoundPage() {
  notFound();
}
