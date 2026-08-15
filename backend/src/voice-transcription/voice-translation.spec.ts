import { isVoiceTranslationConfigured, transcribeAndTranslate } from './voice-translation';

describe('voice-translation', () => {
  const originalKey = process.env.OPENAI_API_KEY;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  });

  it('isVoiceTranslationConfigured reflects whether OPENAI_API_KEY is set', () => {
    delete process.env.OPENAI_API_KEY;
    expect(isVoiceTranslationConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-test';
    expect(isVoiceTranslationConfigured()).toBe(true);
  });

  it('runs dry-run-safe without an API key — never calls fetch, reports dryRun/FAILED', async () => {
    delete process.env.OPENAI_API_KEY;
    const result = await transcribeAndTranslate(Buffer.from('fake audio bytes'), 'note.mp3', 'audio/mpeg', 'yo');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      transcript: null,
      transcriptLang: null,
      translatedText: null,
      translatedLang: null,
      transcriptionStatus: 'FAILED',
      translationStatus: 'NOT_REQUESTED',
      dryRun: true,
    });
  });

  it('transcribes then skips translation when the source is already English', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'Hello, the site looks fine.', language: 'english' }) });

    const result = await transcribeAndTranslate(Buffer.from('audio'), 'note.mp3', 'audio/mpeg');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/audio/transcriptions',
      expect.objectContaining({ method: 'POST', headers: { Authorization: 'Bearer sk-test' } }),
    );
    expect(result).toEqual({
      transcript: 'Hello, the site looks fine.',
      transcriptLang: 'en',
      translatedText: 'Hello, the site looks fine.',
      translatedLang: 'en',
      transcriptionStatus: 'COMPLETED',
      translationStatus: 'COMPLETED',
      dryRun: false,
    });
  });

  it('transcribes in Yoruba (via language hint) then translates with a second call', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'Ile naa dara.', language: 'yoruba' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'The house is good.' }) });

    const result = await transcribeAndTranslate(Buffer.from('audio'), 'note.mp3', 'audio/mpeg', 'yo');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://api.openai.com/v1/audio/translations');
    expect(result).toEqual({
      transcript: 'Ile naa dara.',
      transcriptLang: 'yo',
      translatedText: 'The house is good.',
      translatedLang: 'en',
      transcriptionStatus: 'COMPLETED',
      translationStatus: 'COMPLETED',
      dryRun: false,
    });
  });

  it('never throws on a non-2xx transcription response — reports FAILED', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'unauthorized' });

    const result = await transcribeAndTranslate(Buffer.from('audio'), 'note.mp3', 'audio/mpeg');

    expect(result.transcriptionStatus).toBe('FAILED');
    expect(result.translationStatus).toBe('NOT_REQUESTED');
    expect(result.dryRun).toBe(false);
  });

  it('never throws on a network error — reports FAILED, not an unhandled rejection', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const result = await transcribeAndTranslate(Buffer.from('audio'), 'note.mp3', 'audio/mpeg');

    expect(result.transcriptionStatus).toBe('FAILED');
  });

  it('records a completed transcript but FAILED translation when only the second call fails', async () => {
    process.env.OPENAI_API_KEY = 'sk-test';
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ text: 'Ile naa dara.', language: 'yoruba' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'server error' });

    const result = await transcribeAndTranslate(Buffer.from('audio'), 'note.mp3', 'audio/mpeg');

    expect(result.transcript).toBe('Ile naa dara.');
    expect(result.transcriptionStatus).toBe('COMPLETED');
    expect(result.translatedText).toBeNull();
    expect(result.translationStatus).toBe('FAILED');
  });
});
