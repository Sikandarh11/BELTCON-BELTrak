export interface TagInventoryImportRow {
  epc: string;
  barcode: string;
}

export interface TagInventoryImportAdapter {
  readonly formatId: string;
  parse(bytes: Uint8Array): Promise<TagInventoryImportRow[]>;
}

/**
 * Vendor-neutral JSON format for controlled tests and administrative tooling.
 * A procured supplier format must be implemented as a separate adapter.
 */
export class CanonicalJsonTagInventoryImportAdapter implements TagInventoryImportAdapter {
  readonly formatId = "SBTS_CANONICAL_JSON_V1";

  async parse(bytes: Uint8Array) {
    if (bytes.byteLength === 0 || bytes.byteLength > 1_048_576) {
      throw new Error("TAG_INVENTORY_FILE_SIZE_INVALID");
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw new Error("TAG_INVENTORY_FILE_INVALID");
    }
    if (!Array.isArray(value) || value.length < 1 || value.length > 1000) {
      throw new Error("TAG_INVENTORY_ROW_COUNT_INVALID");
    }
    return value.map((row) => {
      if (
        !row ||
        typeof row !== "object" ||
        Object.getPrototypeOf(row) !== Object.prototype ||
        Object.keys(row).sort().join(",") !== "barcode,epc" ||
        typeof (row as Record<string, unknown>).epc !== "string" ||
        typeof (row as Record<string, unknown>).barcode !== "string"
      ) {
        throw new Error("TAG_INVENTORY_ROW_INVALID");
      }
      return {
        epc: (row as Record<string, string>).epc,
        barcode: (row as Record<string, string>).barcode,
      };
    });
  }
}

export class UnavailableSupplierInventoryImportAdapter implements TagInventoryImportAdapter {
  readonly formatId = "SUPPLIER_FORMAT_UNAVAILABLE";
  async parse(_bytes: Uint8Array): Promise<TagInventoryImportRow[]> {
    throw new Error("TAG_INVENTORY_SUPPLIER_FORMAT_UNAVAILABLE");
  }
}
