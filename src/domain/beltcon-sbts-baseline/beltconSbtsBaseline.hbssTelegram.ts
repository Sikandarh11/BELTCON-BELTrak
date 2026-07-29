import { BhsUidSchema } from "./beltconSbtsBaseline.schemas";

export const HBSS_STX = "\x02";
export const HBSS_CR = "\r";
export const HBSS_LF = "\n";

/** Logical baseline only; final RS-232 framing requires vendor confirmation. */
export function createHbssRecallTelegram(bhsUid: string) {
  return `${HBSS_STX}${BhsUidSchema.parse(bhsUid)}${HBSS_CR}${HBSS_LF}`;
}
