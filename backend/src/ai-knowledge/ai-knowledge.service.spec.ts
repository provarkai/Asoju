import { NotFoundException } from '@nestjs/common';
import { AiKnowledgeCategory } from '@prisma/client';
import { AiKnowledgeService } from './ai-knowledge.service';

/**
 * "Teach the AI the prices and customer service, and deep knowledge of
 * what we are doing" — buildContextBlock() is the mechanism, so these
 * tests focus on proving it actually combines staff-authored entries with
 * the live pricing catalog correctly, and stays silent (null) when there
 * is genuinely nothing to teach — same "don't invent content" discipline
 * PricingEngineService itself already follows.
 */
describe('AiKnowledgeService', () => {
  let prisma: any;
  let audit: any;
  let pricingEngine: any;
  let service: AiKnowledgeService;
  const actor = { id: 'staff-1', role: 'ADMIN', email: 'staff@example.com' };

  beforeEach(() => {
    prisma = {
      aiKnowledgeEntry: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    pricingEngine = { getActivePricingCatalogSummary: jest.fn().mockResolvedValue(null) };
    service = new AiKnowledgeService(prisma, audit, pricingEngine);
  });

  describe('buildContextBlock', () => {
    it('returns null when there are no active entries and no active price book — nothing real to teach yet', async () => {
      const result = await service.buildContextBlock();
      expect(result).toBeNull();
    });

    it('groups active entries by category and includes the live pricing summary, in a stable order', async () => {
      prisma.aiKnowledgeEntry.findMany.mockResolvedValue([
        { category: AiKnowledgeCategory.FAQ, title: 'Do you operate outside Lagos?', content: 'Yes, nationwide.' },
        { category: AiKnowledgeCategory.POLICY, title: 'Refunds', content: 'Within 14 days of payment.' },
        { category: AiKnowledgeCategory.SERVICE_INFO, title: 'Property Inspection', content: 'A licensed agent visits and reports back with photos.' },
      ]);
      pricingEngine.getActivePricingCatalogSummary.mockResolvedValue('- PROPERTY_INSPECTION in LAGOS: $150');

      const result = await service.buildContextBlock();

      expect(result).not.toBeNull();
      expect(result).toContain('BUSINESS KNOWLEDGE');
      expect(result).toContain('Refunds: Within 14 days of payment.');
      expect(result).toContain('Property Inspection: A licensed agent');
      expect(result).toContain('Do you operate outside Lagos?: Yes, nationwide.');
      expect(result).toContain('LIVE PRICING');
      expect(result).toContain('$150');
      // PRICING/SERVICE_INFO/POLICY/FAQ/GENERAL ordering — pricing-adjacent
      // sections lead, matching what a customer is most likely to ask first.
      expect(result!.indexOf('SERVICE INFO')).toBeLessThan(result!.indexOf('POLICY'));
      expect(result!.indexOf('POLICY')).toBeLessThan(result!.indexOf('FAQ'));
      expect(result!.indexOf('FAQ')).toBeLessThan(result!.indexOf('LIVE PRICING'));
    });

    it('never surfaces an inactive entry — the query itself filters isActive:true, not a post-hoc check', async () => {
      await service.buildContextBlock();
      expect(prisma.aiKnowledgeEntry.findMany).toHaveBeenCalledWith({ where: { isActive: true } });
    });

    it('still returns a block from pricing alone, with zero knowledge entries authored yet', async () => {
      pricingEngine.getActivePricingCatalogSummary.mockResolvedValue('- BUSINESS_VERIFICATION in ABUJA: $80');
      const result = await service.buildContextBlock();
      expect(result).toContain('LIVE PRICING');
      expect(result).toContain('$80');
    });
  });

  describe('CRUD', () => {
    it('creates an entry defaulting isActive to true, and audits it under the acting staff member', async () => {
      prisma.aiKnowledgeEntry.create.mockResolvedValue({ id: 'entry-1', category: AiKnowledgeCategory.FAQ, title: 'Q', content: 'A', isActive: true });

      await service.create(actor as any, { category: AiKnowledgeCategory.FAQ, title: 'Q', content: 'A' });

      expect(prisma.aiKnowledgeEntry.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isActive: true }) }),
      );
      expect(audit.record).toHaveBeenCalledWith(expect.objectContaining({ actorId: 'staff-1', action: 'ai_knowledge.created' }));
    });

    it('rejects updating an entry that does not exist rather than silently upserting one', async () => {
      prisma.aiKnowledgeEntry.findUnique.mockResolvedValue(null);
      await expect(service.update(actor as any, 'missing-id', { title: 'New title' })).rejects.toThrow(NotFoundException);
      expect(prisma.aiKnowledgeEntry.update).not.toHaveBeenCalled();
    });

    it('deletes an entry and audits the deletion with its prior content, not a bare id', async () => {
      prisma.aiKnowledgeEntry.findUnique.mockResolvedValue({ id: 'entry-1', category: AiKnowledgeCategory.PRICING, title: 'Deposit policy' });

      await service.remove(actor as any, 'entry-1');

      expect(prisma.aiKnowledgeEntry.delete).toHaveBeenCalledWith({ where: { id: 'entry-1' } });
      expect(audit.record).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'ai_knowledge.deleted', metadata: expect.objectContaining({ title: 'Deposit policy' }) }),
      );
    });
  });
});
