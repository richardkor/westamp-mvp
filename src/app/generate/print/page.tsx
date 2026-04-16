/**
 * /generate/print — Server-side print page for Puppeteer PDF generation.
 *
 * This page is visited by Puppeteer (not by end users directly).
 * It reads form data from the persistent token store (blob-storage-backed)
 * via the token query parameter, then renders the agreement in a
 * print-ready layout.
 *
 * File-based content (NRIC images, inventory photos) cannot be passed
 * through the token store. Where files were present in the original form,
 * this page shows textual placeholders with filenames.
 */

import { getData } from "../../../lib/token-store";
import { PrintAgreement } from "./print-client";

/**
 * Force Node.js runtime. This page reads from the blob-storage-backed
 * token store which uses fs (local mode) or @supabase/supabase-js
 * (Supabase mode) — neither works in Edge runtime.
 */
export const runtime = "nodejs";

interface PrintPageProps {
  searchParams: Promise<{ token?: string }>;
}

export default async function PrintPage({ searchParams }: PrintPageProps) {
  const params = await searchParams;
  const token = params.token;

  if (!token) {
    return <p>Missing token.</p>;
  }

  const result = await getData(token);

  if (result.status === "corrupt") {
    return <p>Render data could not be read. Please try generating the PDF again.</p>;
  }

  if (result.status !== "valid") {
    return <p>Token expired or invalid.</p>;
  }

  // Pass the serialized form data to the client component for rendering.
  // This is safe because the data was just validated from our own token store.
  return <PrintAgreement formDataJson={result.data as Record<string, unknown>} />;
}
