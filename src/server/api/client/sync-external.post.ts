import * as externalClients from '#server/features/vpn/externalClients';
import { defineAuthenticatedEventHandler } from '#server/utils/handler';

export default defineAuthenticatedEventHandler(async ({ user }) => {
  const result = await externalClients.sync(user);
  return { success: true, ...result };
});
