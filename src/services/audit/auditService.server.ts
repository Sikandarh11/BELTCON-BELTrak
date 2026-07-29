import "@tanstack/react-start/server-only";

import { auditRepository, type AuditRepository } from "./auditRepository.server";
import type { AuditFilters } from "./auditSchemas";

export interface AuditService {
  list: AuditRepository["list"];
  get: AuditRepository["get"];
}

export function createAuditService(repository: AuditRepository = auditRepository): AuditService {
  return {
    list: (filters: AuditFilters) => repository.list(filters),
    get: (auditId: string) => repository.get(auditId),
  };
}

export const auditService = createAuditService();
