/**
 * WhatsApp click-to-chat helper.
 *
 * Centralises the phone number placeholder and prefilled message logic
 * so it is not duplicated across page components.
 *
 * If the number needs to change, update WHATSAPP_NUMBER below.
 * The placeholder guard (isPlaceholderNumber) will disable CTAs if the
 * number is ever reverted to a non-numeric placeholder.
 */

/**
 * WhatsApp-enabled Malaysian mobile number for the lawyer CTA.
 * Format: country code + number, no "+", no spaces, no dashes.
 */
export const WHATSAPP_NUMBER = "601125731687";

/** Returns true if WHATSAPP_NUMBER is still a placeholder / not a real number. */
export function isPlaceholderNumber(): boolean {
  return !/^60\d{9,10}$/.test(WHATSAPP_NUMBER);
}

/**
 * Build a WhatsApp click-to-chat URL with a prefilled message.
 * Returns "#" if the number is still a placeholder, so no broken 404 link.
 */
export function buildWhatsAppUrl(message: string): string {
  if (isPlaceholderNumber()) {
    return "#";
  }
  return `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
}

/** Home page — generic message, no form context available. */
export function homePageMessage(): string {
  return "Hello, I found WeStamp and I need help with a customised tenancy agreement. Could you assist?";
}

/** Generate page — includes property address and rent if available. */
export function generatePageMessage(
  propertyAddress?: string,
  monthlyRent?: string
): string {
  const base =
    "Hello, I am creating a tenancy agreement on WeStamp and I need custom clauses or flexible terms.";
  const details = buildDetails(propertyAddress, monthlyRent);
  return details
    ? `${base} ${details} Please contact me.`
    : `${base} Please contact me.`;
}

/** Agreement preview page — includes property address and rent if available. */
export function previewPageMessage(
  propertyAddress?: string,
  monthlyRent?: string
): string {
  const base =
    "Hello, I drafted a tenancy agreement on WeStamp and I need to customise some terms.";
  const details = buildDetails(propertyAddress, monthlyRent);
  return details
    ? `${base} ${details} Please contact me.`
    : `${base} Please contact me.`;
}

// ─── Internal ────────────────────────────────────────────────────────

function buildDetails(
  propertyAddress?: string,
  monthlyRent?: string
): string {
  const parts: string[] = [];
  const addr = propertyAddress?.trim();
  const rent = monthlyRent?.trim();
  if (addr) parts.push(`Property: ${addr}.`);
  if (rent) parts.push(`Monthly rent: RM ${rent}.`);
  return parts.join(" ");
}
