import "@tanstack/react-start/server-only";
import { z } from "zod";
import { getXrayAdminClient } from "@/services/xray/xraySupabase.server";
import { readerAntennaMapSchema, type ReaderAntennaMap } from "./rfidReadSchemas";

const rowSchema = z.object({
  id: z.string().uuid(),
  reader_id: z.string(),
  port_number: z.number().int(),
  name: z.string(),
  zone_code: z.string(),
  direction: z.string().nullable(),
  enabled: z.boolean(),
  readers: z.object({ name: z.string(), status: z.string() }).nullable(),
});
export async function listReaderAntennaMap(): Promise<ReaderAntennaMap[]> {
  const { data, error } = await getXrayAdminClient()
    .from("reader_antennas")
    .select("id,reader_id,port_number,name,zone_code,direction,enabled,readers(name,status)")
    .eq("enabled", true)
    .order("reader_id")
    .order("port_number");
  if (error) throw new Error("Unable to load reader antenna mappings", { cause: error });
  return (data ?? []).map((value) => {
    const row = rowSchema.parse(value);
    return readerAntennaMapSchema.parse({
      readerId: row.reader_id,
      readerName: row.readers?.name ?? row.reader_id,
      readerStatus: row.readers?.status ?? "UNKNOWN",
      antennaId: row.id,
      antennaPort: row.port_number,
      antennaName: row.name,
      zoneCode: row.zone_code,
      direction: row.direction,
      enabled: row.enabled,
    });
  });
}
