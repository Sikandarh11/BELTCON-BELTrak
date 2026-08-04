import "@tanstack/react-start/server-only";

import type { CanonicalRole } from "@/auth/canonicalRoles";

import { readerRepository, type ReaderRepository } from "./readerRepository.server";
import type {
  CreateReaderConfigurationInput,
  ReaderListFilters,
  SetReaderEnabledInput,
  UpdateAntennaInput,
  UpdateReaderInput,
  UpdateReaderConfigurationInput,
} from "./readerSchemas";

export interface ReaderService {
  listReadersForSite(
    siteId: string,
    filters: ReaderListFilters,
  ): ReturnType<ReaderRepository["listReadersForSite"]>;
  getReaderById(siteId: string, readerId: string): ReturnType<ReaderRepository["getReaderById"]>;
  getReaderByIdAcrossSites(readerId: string): ReturnType<ReaderRepository["getReaderByIdAcrossSites"]>;
  getReaderByCode(
    siteId: string,
    readerCode: string,
  ): ReturnType<ReaderRepository["getReaderByCode"]>;
  createReaderConfiguration(
    input: CreateReaderConfigurationInput & {
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): ReturnType<ReaderRepository["createReaderConfiguration"]>;
  updateReaderConfiguration(
    input: UpdateReaderConfigurationInput & {
      readerId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): ReturnType<ReaderRepository["updateReaderConfiguration"]>;
  setReaderEnabled(
    input: SetReaderEnabledInput & {
      readerId: string;
      actorId: string;
      canonicalRole: CanonicalRole;
      requestId: string;
    },
  ): ReturnType<ReaderRepository["setReaderEnabled"]>;
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

export interface ReaderServiceDependencies {
  getSiteId?: () => string;
}

function defaultSiteId() {
  return process.env.SBTS_SITE_ID?.trim() || process.env.BHS_STATION_SITE_ID?.trim() || "ALWAJH";
}

export function createReaderService(
  repository: ReaderRepository = readerRepository,
  dependencies: ReaderServiceDependencies = {},
): ReaderService {
  const getSiteId = dependencies.getSiteId ?? defaultSiteId;
  return {
    listReadersForSite: (siteId, filters) => repository.listReadersForSite({ siteId, filters }),
    getReaderById: (siteId, readerId) => repository.getReaderById({ siteId, readerId }),
    getReaderByIdAcrossSites: (readerId) => repository.getReaderByIdAcrossSites(readerId),
    getReaderByCode: (siteId, readerCode) => repository.getReaderByCode({ siteId, readerCode }),
    createReaderConfiguration: (input) =>
      repository.createReaderConfiguration({ ...input, siteId: getSiteId() }),
    updateReaderConfiguration: (input) =>
      repository.updateReaderConfiguration({ ...input, siteId: getSiteId() }),
    setReaderEnabled: (input) => repository.setReaderEnabled({ ...input, siteId: getSiteId() }),
    list: (filters) => repository.listReadersForSite({ siteId: getSiteId(), filters }),
    get: (readerId) =>
      repository.getReaderById({ siteId: getSiteId(), readerId }) as ReturnType<
        ReaderRepository["get"]
      >,
    updateReader: (input) => repository.updateReader({ ...input, siteId: getSiteId() }),
    updateAntenna: (input) => repository.updateAntenna(input),
    recordRejected: (input) => repository.recordRejected(input),
  };
}

export const readerService = createReaderService();
