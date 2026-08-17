import { ConflictException, Injectable } from '@nestjs/common';
import { IdempotencyOperation, IdempotencyRecordStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

/// docs/AUTOMATION_PRICING_ENGINE_SCOPE.md Phase 2 — duplicate protection
/// for consequential operations (currently: service-request creation,
/// payment initiation). A caller opts in by supplying an
/// `Idempotency-Key` header; a request with no key behaves exactly as it
/// did before this existed — nothing here is a breaking change to any
/// existing client.
///
/// Usage at a call site:
///   const check = await this.idempotency.begin(OP, key, actor.id);
///   if (!check.shouldProceed) return this.reloadExisting(check.resultReference);
///   try {
///     const created = await ...;
///     await this.idempotency.complete(OP, key, actor.id, created.id);
///     return created;
///   } catch (err) {
///     await this.idempotency.fail(OP, key, actor.id);
///     throw err;
///   }
///
/// Deliberately three small explicit methods rather than one generic
/// run()-wrapper that tries to serialize/deserialize an arbitrary result
/// type — each call site already knows how to re-fetch its own resource
/// by id, so `resultReference` only needs to carry that id, not the whole
/// object.
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async begin(
    operation: IdempotencyOperation,
    idempotencyKey: string,
    actorId: string,
  ): Promise<{ shouldProceed: true } | { shouldProceed: false; resultReference: string | null }> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { operation_idempotencyKey_actorId: { operation, idempotencyKey, actorId } },
    });

    if (existing) {
      if (existing.status === IdempotencyRecordStatus.SUCCEEDED) {
        return { shouldProceed: false, resultReference: existing.resultReference };
      }
      if (existing.status === IdempotencyRecordStatus.PROCESSING) {
        // Genuinely concurrent retry (e.g. a client that fired the same
        // request twice before the first returned) — tell it to back off
        // rather than silently letting two copies of a consequential
        // operation race each other.
        throw new ConflictException('This request is already being processed — please wait and retry.');
      }
      // FAILED — clear it so the operation can be attempted again under
      // the same key. Tolerate a concurrent delete of the same row (two
      // failed retries racing this cleanup) rather than erroring on it.
      await this.prisma.idempotencyRecord.delete({ where: { id: existing.id } }).catch(() => undefined);
    }

    try {
      await this.prisma.idempotencyRecord.create({
        data: { operation, idempotencyKey, actorId, status: IdempotencyRecordStatus.PROCESSING },
      });
      return { shouldProceed: true };
    } catch (err) {
      // Two concurrent requests both passed the findUnique check above
      // and both tried to create — the unique constraint on
      // (operation, idempotencyKey, actorId) lets exactly one win. The
      // loser gets a real, race-safe 409 instead of a naive check-then-
      // write race condition.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This request is already being processed — please wait and retry.');
      }
      throw err;
    }
  }

  async complete(operation: IdempotencyOperation, idempotencyKey: string, actorId: string, resultReference: string) {
    await this.prisma.idempotencyRecord.updateMany({
      where: { operation, idempotencyKey, actorId },
      data: { status: IdempotencyRecordStatus.SUCCEEDED, resultReference },
    });
  }

  async fail(operation: IdempotencyOperation, idempotencyKey: string, actorId: string) {
    await this.prisma.idempotencyRecord.updateMany({
      where: { operation, idempotencyKey, actorId },
      data: { status: IdempotencyRecordStatus.FAILED },
    });
  }
}
