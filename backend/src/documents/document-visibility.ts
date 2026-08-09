import { DocumentVisibility } from '@prisma/client';

/**
 * Shared between DocumentsService (GET /cases/:id/documents) and
 * CasesService.getCaseDetail (GET /cases/:id, which embeds the same
 * documents unfiltered via a Prisma `include` — both paths must apply the
 * same rule or the second one leaks past the first). Customer and staff
 * never call this: they always see every document on their own case.
 */
export function filterDocumentsForFieldActor<
  T extends { visibility: DocumentVisibility; restrictedToAssignmentId: string | null },
>(documents: T[], ownAssignmentIds: Set<string>): T[] {
  return documents.filter((doc) => {
    if (doc.visibility === DocumentVisibility.STAFF_ONLY) return false;
    if (doc.visibility === DocumentVisibility.ASSIGNEE) {
      return doc.restrictedToAssignmentId !== null && ownAssignmentIds.has(doc.restrictedToAssignmentId);
    }
    return true; // ALL
  });
}
