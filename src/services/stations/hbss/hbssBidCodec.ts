import { BhsUidSchema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";

export type HbssBidFramingProfile = "STX_BAGID_CRLF" | "ASCII_BAGID_ONLY" | "VENDOR_CONFIRMED";

export type HbssBidFramingStatus = "PENDING_VENDOR_CONFIRMATION" | "VENDOR_APPROVED";

export class HbssBidCodecError extends Error {
  constructor(
    message: string,
    readonly code = "HBSS_BID_ENCODING_INVALID",
  ) {
    super(message);
  }
}

function ascii(value: string) {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

/** Encodes only profiles explicitly named by the software FAT contract. */
export function encodeHbssBidRequest(bhsUid: string, profile: HbssBidFramingProfile): Uint8Array {
  const parsed = BhsUidSchema.safeParse(bhsUid);
  if (!parsed.success) {
    throw new HbssBidCodecError("HBSS BID requires an exact ten-character BHS BagID");
  }
  const bag = ascii(parsed.data);
  if (profile === "ASCII_BAGID_ONLY") return bag;
  if (profile === "STX_BAGID_CRLF") {
    const bytes = new Uint8Array(13);
    bytes[0] = 0x02;
    bytes.set(bag, 1);
    bytes[11] = 0x0d;
    bytes[12] = 0x0a;
    return bytes;
  }
  throw new HbssBidCodecError(
    "Vendor-confirmed HBSS framing is not configured",
    "HBSS_VENDOR_FRAMING_UNAVAILABLE",
  );
}
