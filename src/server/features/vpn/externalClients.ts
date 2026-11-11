import { createError } from 'nuxt/server';
import { $fetch } from 'ofetch';

import { insertClient } from './clients';
import { commit } from './lifecycle';
import { authorize, isExpired, type Actor } from './policies';

import { WG_ENV } from '#server/utils/config';
import { wg } from '#server/utils/wgHelper';

/** Clients named with this prefix are owned by the Keycloak sync. */
export const EXTERNAL_PREFIX = 'kc_';

type Member = { username: string; enabled: boolean };
type ExistingClient = {
  id: number;
  name: string;
  enabled: boolean;
  expiresAt: string | null;
};

/**
 * Keycloak always wins for `kc_` clients: removed members are deleted,
 * disabled members are disabled, and enabled members are (re-)enabled.
 */
export function planSync(members: Member[], clients: ExistingClient[]) {
  const wanted = new Map(
    members.map((m) => [EXTERNAL_PREFIX + m.username, m.enabled])
  );
  const synced = clients.filter((c) => c.name.startsWith(EXTERNAL_PREFIX));
  const existing = new Set(synced.map((c) => c.name));
  const now = Date.now();
  return {
    create: [...wanted]
      .filter(([name, enabled]) => enabled && !existing.has(name))
      .map(([name]) => name),
    remove: synced.filter((c) => !wanted.has(c.name)).map((c) => c.id),
    enable: synced
      .filter(
        (c) =>
          wanted.get(c.name) === true &&
          !c.enabled &&
          !isExpired(c.expiresAt, now)
      )
      .map((c) => c.id),
    disable: synced
      .filter((c) => wanted.get(c.name) === false && c.enabled)
      .map((c) => c.id),
  };
}

async function fetchMembers(): Promise<Member[]> {
  const ecfk = WG_ENV.ECFK;
  if (!ecfk) {
    throw createError({
      status: 403,
      statusText: 'External clients are not configured',
    });
  }
  const { access_token } = await $fetch<{ access_token: string }>(
    `${ecfk.server}/protocol/openid-connect/token`,
    {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: ecfk.clientId,
        client_secret: ecfk.clientSecret,
      }),
    }
  );
  const api = $fetch.create({
    baseURL: ecfk.adminUrl,
    headers: { Authorization: `Bearer ${access_token}` },
  });
  // A path of `/<name>` only matches a top-level group.
  const group = await api<{ id: string }>(
    `/group-by-path/${encodeURIComponent(ecfk.targetGroup)}`
  );
  const members: Member[] = [];
  const max = 100;
  for (let first = 0; ; first += max) {
    const page = await api<Member[]>(`/groups/${group.id}/members`, {
      query: { first, max, briefRepresentation: true },
    });
    members.push(...page);
    if (page.length < max) {
      return members;
    }
  }
}

export async function sync(actor: Actor) {
  authorize(actor, 'clients', 'create');
  const members = await fetchMembers();
  return commit(async (tx) => {
    const plan = planSync(members, await tx.clients.getAll());
    if (plan.remove.length) {
      await tx.clients.deleteMany(plan.remove);
    }
    if (plan.enable.length) {
      await tx.clients.setEnabled(plan.enable, true);
    }
    if (plan.disable.length) {
      await tx.clients.setEnabled(plan.disable, false);
    }
    for (const name of plan.create) {
      const privateKey = await wg.generatePrivateKey();
      const publicKey = await wg.getPublicKey(privateKey);
      await insertClient(
        tx,
        { name, expiresAt: null },
        { privateKey, publicKey }
      );
    }
    return {
      created: plan.create.length,
      removed: plan.remove.length,
      enabled: plan.enable.length,
      disabled: plan.disable.length,
    };
  });
}
