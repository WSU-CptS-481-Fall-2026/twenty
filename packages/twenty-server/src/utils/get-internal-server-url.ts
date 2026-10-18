import { cleanServerUrl } from 'src/utils/clean-server-url';

export const getInternalServerUrl = ({
  serverInternalUrlEnv,
  serverUrlEnv,
}: {
  serverInternalUrlEnv?: string;
  serverUrlEnv: string;
}): string => {
  const internalUrl = cleanServerUrl(serverInternalUrlEnv);
  const publicUrl = cleanServerUrl(serverUrlEnv);

  return internalUrl || publicUrl || '';
};
