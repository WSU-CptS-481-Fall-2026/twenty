import { setupI18n } from '@lingui/core';
import { generateMessageId } from 'twenty-shared/i18n';

import { messages as arabicMessages } from 'src/engine/core-modules/i18n/locales/generated/ar-SA';
import { type EffectiveEntityI18nContext } from 'src/engine/metadata-modules/overrides/types/effective-entity-i18n-context.type';
import { resolveEffectiveTranslatedFlatEntity } from 'src/engine/metadata-modules/overrides/utils/resolve-effective-translated-flat-entity.util';

const CUSTOM = '20202020-aaaa-4aaa-8aaa-000000000001';
const OWNER = '20202020-bbbb-4bbb-8bbb-000000000002';

const flatFieldMetadata = {
  applicationUniversalIdentifier: OWNER,
  label: 'Company',
  description: null,
  icon: 'IconBuilding',
  isActive: true,
  overrides: null as unknown,
};

const buildI18nContext = (
  partial: Partial<EffectiveEntityI18nContext> = {},
): EffectiveEntityI18nContext => ({
  locale: 'fr-FR',
  i18nInstance: { _: (id: string) => `translated:${id}` },
  isStandardApp: true,
  workspaceCustomApplicationUniversalIdentifier: CUSTOM,
  ownerApplicationUniversalIdentifier: OWNER,
  ...partial,
});

describe('resolveEffectiveTranslatedFlatEntity', () => {
  it('translates a standard label through the catalog when nothing overrides it', () => {
    const messageId = generateMessageId('Company', 'fieldMetadata.label');

    expect(
      resolveEffectiveTranslatedFlatEntity({
        metadataName: 'fieldMetadata',
        flatEntity: flatFieldMetadata,
        i18nContext: buildI18nContext(),
      }).label,
    ).toBe(`translated:${messageId}`);
  });

  it('prefers a workspace translation, then the override, for the locale', () => {
    const resolve = (overrides: unknown) =>
      resolveEffectiveTranslatedFlatEntity({
        metadataName: 'fieldMetadata',
        flatEntity: { ...flatFieldMetadata, overrides },
        i18nContext: buildI18nContext(),
      }).label;

    expect(
      resolve({
        [CUSTOM]: {
          label: 'Société',
          translations: { 'fr-FR': { label: 'Entreprise' } },
        },
      }),
    ).toBe('Entreprise');
    expect(resolve({ [CUSTOM]: { label: 'Société' } })).toBe('Société');
  });

  it('resolves non-translatable properties with their own type', () => {
    const effective = resolveEffectiveTranslatedFlatEntity({
      metadataName: 'fieldMetadata',
      flatEntity: {
        ...flatFieldMetadata,
        overrides: { [CUSTOM]: { icon: 'IconStar', isActive: false } },
      },
      i18nContext: buildI18nContext(),
    });

    expect(effective.icon).toBe('IconStar');
    expect(effective.isActive).toBe(false);
  });

  const resolveCustomFieldLabel = ({
    label,
    overrides = null,
    i18nInstance,
  }: {
    label: string;
    overrides?: unknown;
    i18nInstance: EffectiveEntityI18nContext['i18nInstance'];
  }) =>
    resolveEffectiveTranslatedFlatEntity({
      metadataName: 'fieldMetadata',
      flatEntity: {
        ...flatFieldMetadata,
        label,
        overrides,
        applicationUniversalIdentifier: CUSTOM,
      },
      i18nContext: buildI18nContext({
        isStandardApp: false,
        ownerApplicationUniversalIdentifier: CUSTOM,
        i18nInstance,
      }),
    }).label;

  it("translates a custom object's system field label with Twenty's catalog", () => {
    const arabicI18n = setupI18n({
      locale: 'ar-SA',
      messages: { 'ar-SA': arabicMessages },
    });

    expect(
      resolveCustomFieldLabel({
        label: 'Creation date',
        i18nInstance: arabicI18n,
      }),
    ).toBe('تاريخ الإنشاء');
  });

  it("keeps a custom label that Twenty's catalog does not know", () => {
    expect(
      resolveCustomFieldLabel({
        label: 'Contract renewal',
        i18nInstance: { _: (id: string) => id },
      }),
    ).toBe('Contract renewal');
  });

  it('keeps a renamed custom label as written', () => {
    expect(
      resolveCustomFieldLabel({
        label: 'Tasks',
        overrides: { [CUSTOM]: { label: 'Tasks' } },
        i18nInstance: { _: (id: string) => `translated:${id}` },
      }),
    ).toBe('Tasks');
  });
});
