import { buildSavingsPlan, estimateAnnualTax, projectEarnings } from './agent-financial-planning.service';

describe('projectEarnings', () => {
  it('returns a zeroed no_history projection when there is no earnings history', () => {
    const projection = projectEarnings([]);
    expect(projection).toEqual({
      basis: 'no_history',
      monthsOfHistory: 0,
      trailingAverageMonthlyNaira: 0,
      projectedNextMonthNaira: 0,
      projectedNextQuarterNaira: 0,
      projectedNextYearNaira: 0,
    });
  });

  it('projects off the trailing average, even with a single month of history', () => {
    const projection = projectEarnings([{ month: '2026-07', totalNaira: 60000, earningCount: 2 }]);
    expect(projection).toMatchObject({
      basis: 'trailing_average',
      monthsOfHistory: 1,
      trailingAverageMonthlyNaira: 60000,
      projectedNextMonthNaira: 60000,
      projectedNextQuarterNaira: 180000,
      projectedNextYearNaira: 720000,
    });
  });

  it('averages across multiple months', () => {
    const projection = projectEarnings([
      { month: '2026-05', totalNaira: 50000, earningCount: 1 },
      { month: '2026-06', totalNaira: 70000, earningCount: 2 },
      { month: '2026-07', totalNaira: 60000, earningCount: 1 },
    ]);
    // average = (50000+70000+60000)/3 = 60000
    expect(projection.trailingAverageMonthlyNaira).toBe(60000);
    expect(projection.projectedNextQuarterNaira).toBe(180000);
    expect(projection.projectedNextYearNaira).toBe(720000);
  });
});

describe('buildSavingsPlan', () => {
  it('defaults to a 15% recommended savings rate', () => {
    const plan = buildSavingsPlan(60000);
    expect(plan).toEqual({
      recommendedRatePercent: 15,
      recommendedMonthlySavingsNaira: 9000,
      projected6MonthNaira: 54000,
      projected12MonthNaira: 108000,
    });
  });

  it('honours a custom savings rate', () => {
    const plan = buildSavingsPlan(100000, 20);
    expect(plan.recommendedMonthlySavingsNaira).toBe(20000);
    expect(plan.projected6MonthNaira).toBe(120000);
    expect(plan.projected12MonthNaira).toBe(240000);
  });
});

describe('estimateAnnualTax', () => {
  it('returns a zero estimate for zero/negative income', () => {
    expect(estimateAnnualTax(0).totalEstimatedTaxNaira).toBe(0);
    expect(estimateAnnualTax(-5000).totalEstimatedTaxNaira).toBe(0);
  });

  it('computes CRA and graduated bands exactly for a mid-range income', () => {
    // gross = 1,000,000
    // CRA = max(200000, 1% of 1,000,000=10000) + 20% of 1,000,000
    //     = 200000 + 200000 = 400000
    // taxable = 1,000,000 - 400,000 = 600,000
    // Band 1: first 300,000 @ 7% = 21,000
    // Band 2: next 300,000 (exactly what remains) @ 11% = 33,000
    const estimate = estimateAnnualTax(1_000_000);
    expect(estimate.consolidatedReliefAllowanceNaira).toBe(400000);
    expect(estimate.taxableIncomeNaira).toBe(600000);
    expect(estimate.bands).toEqual([
      { bandLabel: 'First ₦300,000', taxableInBandNaira: 300000, ratePercent: 7, taxInBandNaira: 21000 },
      { bandLabel: 'Next ₦300,000', taxableInBandNaira: 300000, ratePercent: 11, taxInBandNaira: 33000 },
    ]);
    expect(estimate.totalEstimatedTaxNaira).toBe(54000);
    expect(estimate.effectiveRatePercent).toBe(5.4);
  });

  it('always carries the informational-only disclaimer', () => {
    expect(estimateAnnualTax(500000).disclaimer).toMatch(/Not certified tax advice/);
  });
});
