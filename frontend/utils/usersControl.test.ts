import { beforeEach, describe, expect, it, vi } from 'vitest';
import { updateLocale } from './usersControl';

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock('@/config/config', () => ({
  default: { apiServer: 'http://api.test' },
}));

describe('signed-in locale persistence client', () => {
  beforeEach(() => {
    mocks.fetch.mockReset();
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('sends Spanish locale updates to the existing API and returns the persisted user', async () => {
    const result = { user: { locale: 'es' } };
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => result });

    await expect(updateLocale('jwt', 'es')).resolves.toEqual(result);

    expect(mocks.fetch).toHaveBeenCalledWith('http://api.test/users/locale', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer jwt',
      },
      body: JSON.stringify({ locale: 'es' }),
    });
  });
});
