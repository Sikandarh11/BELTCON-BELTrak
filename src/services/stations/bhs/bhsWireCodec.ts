import { BhsBagMessageV1Schema } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.schemas";
import type { BhsBagMessageV1 } from "@/domain/beltcon-sbts-baseline/beltconSbtsBaseline.types";

export const BHS_MESSAGE_2001_PAYLOAD_BYTES = 14;
export const BHS_ACKNOWLEDGEMENT_2002_PAYLOAD_BYTES = 11;

export type BhsPhysicalMappingStatus = "UNCONFIRMED" | "SIMULATED" | "VENDOR_APPROVED";

export interface BhsWireMessage2001 extends BhsBagMessageV1 {
  physicalMappingStatus: BhsPhysicalMappingStatus;
}

export interface BhsWireAcknowledgement2002 {
  messageType: 2002;
  ack: number;
  bhsUid: string;
  mappingStatus: "PENDING_VENDOR_CONFIRMATION" | "VENDOR_APPROVED";
}

export class BhsWireCodecError extends Error {
  readonly code = "BHS_WIRE_MESSAGE_INVALID";
}

function assertExactLength(bytes: Uint8Array, expected: number, label: string) {
  if (bytes.byteLength !== expected) {
    throw new BhsWireCodecError(`${label} must be exactly ${expected} bytes`);
  }
}

function decodePrintableAscii(bytes: Uint8Array, field: string) {
  for (const byte of bytes) {
    if (byte < 0x20 || byte > 0x7e) {
      throw new BhsWireCodecError(`${field} must contain printable ASCII bytes only`);
    }
  }
  return String.fromCharCode(...bytes);
}

function asciiBytes(value: string) {
  return Uint8Array.from([...value].map((character) => character.charCodeAt(0)));
}

/**
 * Decodes the documented 14-byte message-2001 payload. The logical message
 * selector and final PLC memory offsets remain outside this codec.
 */
export function decodeBhsWireMessage2001(
  bytes: Uint8Array,
  physicalMappingStatus: BhsPhysicalMappingStatus = "SIMULATED",
): BhsWireMessage2001 {
  assertExactLength(bytes, BHS_MESSAGE_2001_PAYLOAD_BYTES, "BHS message 2001 payload");
  const trigger = bytes[0];
  if (trigger !== 1) throw new BhsWireCodecError("BHS message 2001 trigger is invalid");
  const lineId = decodePrintableAscii(bytes.subarray(1, 3), "LineID");
  const bhsUid = decodePrintableAscii(bytes.subarray(3, 13), "BHS BagID");
  const evaluation = decodePrintableAscii(bytes.subarray(13, 14), "Evaluation");
  const semantic = BhsBagMessageV1Schema.safeParse({
    messageType: 2001,
    trigger,
    lineId,
    bhsUid,
    evaluation,
  });
  if (!semantic.success) {
    throw new BhsWireCodecError(
      semantic.error.issues[0]?.message ?? "BHS message 2001 fields are invalid",
    );
  }
  return { ...semantic.data, physicalMappingStatus };
}

/** Simulator-only inverse of the documented 14-byte payload contract. */
export function encodeBhsWireMessage2001(message: BhsBagMessageV1): Uint8Array {
  const parsed = BhsBagMessageV1Schema.parse(message);
  const bytes = new Uint8Array(BHS_MESSAGE_2001_PAYLOAD_BYTES);
  bytes[0] = parsed.trigger;
  bytes.set(asciiBytes(parsed.lineId), 1);
  bytes.set(asciiBytes(parsed.bhsUid), 3);
  bytes.set(asciiBytes(parsed.evaluation), 13);
  return bytes;
}

/** Splits an already framed simulator burst; partial frames are rejected. */
export function decodeBhsWireMessage2001Burst(
  bytes: Uint8Array,
  physicalMappingStatus: BhsPhysicalMappingStatus = "SIMULATED",
) {
  if (bytes.byteLength === 0 || bytes.byteLength % BHS_MESSAGE_2001_PAYLOAD_BYTES !== 0) {
    throw new BhsWireCodecError("BHS message burst contains a partial frame");
  }
  const messages: BhsWireMessage2001[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BHS_MESSAGE_2001_PAYLOAD_BYTES) {
    messages.push(
      decodeBhsWireMessage2001(
        bytes.subarray(offset, offset + BHS_MESSAGE_2001_PAYLOAD_BYTES),
        physicalMappingStatus,
      ),
    );
  }
  return messages;
}

/**
 * Encodes only the documented Ack+BagID payload. The physical representation
 * of logical selector 2002 is intentionally not invented.
 */
export function encodeBhsWireAcknowledgement2002Payload(
  acknowledgement: BhsWireAcknowledgement2002,
): Uint8Array {
  if (acknowledgement.messageType !== 2002) {
    throw new BhsWireCodecError("BHS acknowledgement message type must be 2002");
  }
  if (
    !Number.isInteger(acknowledgement.ack) ||
    acknowledgement.ack < 0 ||
    acknowledgement.ack > 255
  ) {
    throw new BhsWireCodecError("BHS acknowledgement byte must be an integer from 0 to 255");
  }
  const bag = BhsBagMessageV1Schema.shape.bhsUid.safeParse(acknowledgement.bhsUid);
  if (!bag.success) throw new BhsWireCodecError("BHS acknowledgement BagID is invalid");
  const bytes = new Uint8Array(BHS_ACKNOWLEDGEMENT_2002_PAYLOAD_BYTES);
  bytes[0] = acknowledgement.ack;
  bytes.set(asciiBytes(bag.data), 1);
  return bytes;
}

export function assertAcknowledgementMatches(
  acknowledgement: BhsWireAcknowledgement2002,
  message: Pick<BhsWireMessage2001, "bhsUid">,
) {
  if (acknowledgement.bhsUid !== message.bhsUid) {
    throw new BhsWireCodecError("BHS acknowledgement BagID does not match the inbound message");
  }
}
