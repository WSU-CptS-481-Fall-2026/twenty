import { isNonEmptyString } from '@sniptt/guards';
import { isDefined } from 'twenty-shared/utils';

import {
  generateMessageId,
  METADATA_LABEL_PLACEHOLDER_PASS_THROUGH,
} from 'twenty-shared/i18n';

import { type MessageIdTranslator } from 'src/engine/metadata-modules/overrides/types/message-id-translator.type';

export const translateStandardLabel = ({
  sourceValue,
  context,
  applicationCatalog,
  i18nInstance,
}: {
  sourceValue: string;
  context?: string;
  applicationCatalog: Record<string, string> | undefined;
  i18nInstance: MessageIdTranslator;
}): string => {
  if (!isNonEmptyString(sourceValue)) {
    return sourceValue ?? '';
  }

  const messageId = generateMessageId(sourceValue, context);
  const applicationTranslation = applicationCatalog?.[messageId];

  if (isDefined(applicationTranslation)) {
    return applicationTranslation;
  }

  const translatedMessage = i18nInstance._(
    messageId,
    METADATA_LABEL_PLACEHOLDER_PASS_THROUGH,
  );

  return translatedMessage === messageId ? sourceValue : translatedMessage;
};
