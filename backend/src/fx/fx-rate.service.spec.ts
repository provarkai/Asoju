import { FxRateService } from './fx-rate.service';

describe('FxRateService — live rate + cache/fallback', () => {
  let fetchMock: jest.Mock;
  let service: FxRateService;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new FxRateService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('fetches and returns the live rate on a successful call', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ rates: { GBP: 0.74, EUR: 0.86 } }) });

    await expect(service.getRate('GBP')).resolves.toBe(0.74);
    await expect(service.getRate('EUR')).resolves.toBe(0.86);
    // Second call for the same currency within the cache window doesn't
    // re-fetch — one live call served both getRate() calls above too.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the last known-good rate (with a warning, not an error) when a later fetch fails but a cache exists', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ rates: { GBP: 0.74, EUR: 0.86 } }) });
    await service.getRate('GBP');

    // Force the cache to look expired so the next call actually re-fetches.
    (service as unknown as { cache: { fetchedAt: number } }).cache.fetchedAt = Date.now() - 2 * 60 * 60 * 1000;
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(service.getRate('GBP')).resolves.toBe(0.74);
  });

  it('throws when the live call fails and there is no cache to fall back on', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));

    await expect(service.getRate('GBP')).rejects.toThrow('Exchange rate is temporarily unavailable');
  });

  it('throws on a non-2xx response with no cache', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    await expect(service.getRate('EUR')).rejects.toThrow('Exchange rate is temporarily unavailable');
  });
});
