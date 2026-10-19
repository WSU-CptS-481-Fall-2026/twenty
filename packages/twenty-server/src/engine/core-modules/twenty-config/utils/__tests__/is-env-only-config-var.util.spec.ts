import { isEnvOnlyConfigVar } from 'src/engine/core-modules/twenty-config/utils/is-env-only-config-var.util';

describe('isEnvOnlyConfigVar', () => {
  it('should keep the GCS endpoint out of runtime configuration', () => {
    expect(isEnvOnlyConfigVar('STORAGE_GCS_API_ENDPOINT')).toBe(true);
  });

  it('should leave the GCS bucket configurable at runtime', () => {
    expect(isEnvOnlyConfigVar('STORAGE_GCS_BUCKET_NAME')).toBe(false);
  });
});
