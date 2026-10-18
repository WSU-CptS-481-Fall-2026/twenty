import { getInternalServerUrl } from 'src/utils/get-internal-server-url';

describe('getInternalServerUrl', () => {
  it('falls back to SERVER_URL when SERVER_INTERNAL_URL is not set', () => {
    expect(
      getInternalServerUrl({
        serverInternalUrlEnv: undefined,
        serverUrlEnv: 'https://crm.example.com',
      }),
    ).toBe('https://crm.example.com');
  });

  it('falls back to SERVER_URL when SERVER_INTERNAL_URL is empty', () => {
    expect(
      getInternalServerUrl({
        serverInternalUrlEnv: '',
        serverUrlEnv: 'https://crm.example.com',
      }),
    ).toBe('https://crm.example.com');
  });

  it('prefers SERVER_INTERNAL_URL when set', () => {
    expect(
      getInternalServerUrl({
        serverInternalUrlEnv: 'http://twenty:3000',
        serverUrlEnv: 'https://crm.example.com',
      }),
    ).toBe('http://twenty:3000');
  });

  it('strips trailing slashes on both values', () => {
    expect(
      getInternalServerUrl({
        serverInternalUrlEnv: 'http://twenty:3000/',
        serverUrlEnv: 'https://crm.example.com/',
      }),
    ).toBe('http://twenty:3000');

    expect(
      getInternalServerUrl({
        serverInternalUrlEnv: undefined,
        serverUrlEnv: 'https://crm.example.com/',
      }),
    ).toBe('https://crm.example.com');
  });
});
