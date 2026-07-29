import "@tanstack/react-start/server-only";

import type { CanonicalRole } from "@/auth/canonicalRoles";

import { readerRepository, type ReaderRepository } from "./readerRepository.server";
import type { ReaderListFilters, UpdateAntennaInput, UpdateReaderInput } from "./readerSchemas";

export interface ReaderService {
  list(filters: ReaderListFilters): ReturnType<ReaderRepository["list"]>;
  get(readerId: string): ReturnType<ReaderRepository["get"]>;
  updateReader(
    input: UpdateReaderInput & {
      readerId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): ReturnType<ReaderRepository["updateReader"]>;
  updateAntenna(
    input: UpdateAntennaInput & {
      readerId: string;
      antennaId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): ReturnType<ReaderRepository["updateAntenna"]>;
  recordRejected: ReaderRepository["recordRejected"];
}

export function createReaderService(
  repository: ReaderRepository = readerRepository,
): ReaderService {
  return {
    list: (filters) => repository.list(filters),
    get: (readerId) => repository.get(readerId),
    updateReader: (input) => repository.updateReader(input),
    updateAntenna: (input) => repository.updateAntenna(input),
    recordRejected: (input) => repository.recordRejected(input),
  };
}

export const readerService = createReaderService();
