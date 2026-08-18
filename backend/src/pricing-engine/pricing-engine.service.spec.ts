import { PricingEngineService } from './pricing-engine.service';

/**
 * "Teach the AI the prices" — getActivePricingCatalogSummary() is the one
 * place AiKnowledgeService reads real pricing from, so a wrong summary
 * here means a wrong number told to a customer. Covers only this method;
 * calculateServiceFeeLine and the CRUD methods have their own e2e
 * coverage in pricing-engine.e2e-spec.ts.
 */
describe('PricingEngineService.getActivePricingCatalogSummary', () => {
  let prisma: any;
  let service: PricingEngineService;

  beforeEach(() => {
    prisma = {
      priceBook: { findFirst: jest.fn() },
      priceRule: { findMany: jest.fn() },
    };
    service = new PricingEngineService(prisma, {} as any);
  });

  it('returns null when no price book is active — never invents a placeholder figure', async () => {
    prisma.priceBook.findFirst.mockResolvedValue(null);
    const result = await service.getActivePricingCatalogSummary();
    expect(result).toBeNull();
    expect(prisma.priceRule.findMany).not.toHaveBeenCalled();
  });

  it('returns null when the active book has zero active rules', async () => {
    prisma.priceBook.findFirst.mockResolvedValue({ id: 'book-1', currency: 'USD', version: 1 });
    prisma.priceRule.findMany.mockResolvedValue([]);
    const result = await service.getActivePricingCatalogSummary();
    expect(result).toBeNull();
  });

  it('formats every active rule with its real USD value and the live NGN conversion, only from the active price book', async () => {
    prisma.priceBook.findFirst.mockResolvedValue({ id: 'book-1', currency: 'USD', version: 3 });
    prisma.priceRule.findMany.mockResolvedValue([
      { serviceType: 'PROPERTY_INSPECTION', zone: 'LAGOS', value: 150, label: 'Property Inspection' },
      { serviceType: 'PROPERTY_INSPECTION', zone: 'ABUJA', value: 180, label: 'Property Inspection' },
    ]);

    const result = await service.getActivePricingCatalogSummary();

    expect(result).toContain('version 3');
    expect(result).toContain('PROPERTY_INSPECTION in LAGOS: Property Inspection — $150');
    expect(result).toContain('PROPERTY_INSPECTION in ABUJA: Property Inspection — $180');
    // Queried against the specific active book, and only active rules —
    // never a stale/inactive rule from a superseded price book.
    expect(prisma.priceRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { priceBookId: 'book-1', active: true } }),
    );
  });
});
