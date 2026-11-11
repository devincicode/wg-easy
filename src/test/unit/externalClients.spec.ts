import { beforeEach, describe, expect, test, vi } from 'vitest';

import { vpnFixture } from '../helpers/vpn';

import { roles } from '#shared/utils/permissions';
import { WG_ENV } from '#server/utils/config';
import { planSync, sync } from '#server/features/vpn/externalClients';

const { fetch } = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('ofetch', () => ({
  $fetch: Object.assign(fetch, {
    create:
      ({ baseURL }: { baseURL: string }) =>
      (path: string, opts?: unknown) =>
        fetch(baseURL + path, opts),
  }),
}));

const admin = { id: 1, role: roles.ADMIN };
const ecfk = {
  server: 'https://kc.test/realms/acme',
  adminUrl: 'https://kc.test/admin/realms/acme',
  clientId: 'wg',
  clientSecret: 'secret',
  targetGroup: 'vpn users',
};

function client(id: number, name: string, enabled = true, expiresAt = null) {
  return { id, name, enabled, expiresAt } as {
    id: number;
    name: string;
    enabled: boolean;
    expiresAt: string | null;
  };
}

describe('planSync', () => {
  test('creates, removes, enables and disables only kc_ clients', () => {
    const plan = planSync(
      [
        { username: 'new', enabled: true },
        { username: 'kept', enabled: true },
        { username: 'back', enabled: true },
        { username: 'off', enabled: false },
        { username: 'offnew', enabled: false },
      ],
      [
        client(1, 'kc_kept'),
        client(2, 'kc_back', false),
        client(3, 'kc_off'),
        client(4, 'kc_gone'),
        client(5, 'gone'),
        client(6, 'new'),
      ]
    );
    expect(plan).toEqual({
      create: ['kc_new'],
      remove: [4],
      enable: [2],
      disable: [3],
    });
  });

  test('does not re-enable an expired client', () => {
    const expired = { ...client(1, 'kc_a', false), expiresAt: '2000-01-01' };
    expect(
      planSync([{ username: 'a', enabled: true }], [expired]).enable
    ).toEqual([]);
  });

  test('a renamed user is deleted and recreated', () => {
    const plan = planSync(
      [{ username: 'new-name', enabled: true }],
      [client(1, 'kc_old-name')]
    );
    expect(plan.remove).toEqual([1]);
    expect(plan.create).toEqual(['kc_new-name']);
  });
});

describe('sync', () => {
  beforeEach(() => {
    fetch.mockReset();
    WG_ENV.ECFK = ecfk;
  });

  test('applies Keycloak group membership to the client list', async () => {
    const { store } = await vpnFixture();
    await store.clients.insert({
      ...(await store.clients.get(1))!,
      id: 2,
      name: 'kc_gone',
      publicKey: 'gone',
      ipv4Address: '10.8.0.3',
      ipv6Address: 'fdcc:ad94:bacf:61a4::cafe:3',
    });
    fetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/token')) {
        return { access_token: 'token' };
      }
      if (url.includes('/group-by-path/')) {
        return { id: 'group-id' };
      }
      return [{ username: 'alice', enabled: true }];
    });

    await expect(sync(admin)).resolves.toEqual({
      created: 1,
      removed: 1,
      enabled: 0,
      disabled: 0,
    });

    const names = (await store.clients.getAll()).map((c) => c.name).sort();
    expect(names).toEqual(['Client', 'kc_alice']);
    expect(fetch).toHaveBeenCalledWith(
      'https://kc.test/realms/acme/protocol/openid-connect/token',
      expect.objectContaining({ method: 'POST' })
    );
    expect(fetch).toHaveBeenCalledWith(
      'https://kc.test/admin/realms/acme/group-by-path/vpn%20users',
      undefined
    );
  });

  test('pages through group members', async () => {
    const { commands } = await vpnFixture();
    let key = 0;
    commands.generatePrivateKey.mockImplementation(async () => `k${++key}`);
    commands.getPublicKey.mockImplementation(async (k) => `pub-${k}`);
    const page = (n: number, offset: number) =>
      Array.from({ length: n }, (_, i) => ({
        username: `u${offset + i}`,
        enabled: true,
      }));
    fetch.mockImplementation(
      async (url: string, opts?: { query?: { first: number } }) => {
        if (url.endsWith('/token')) {
          return { access_token: 'token' };
        }
        if (url.includes('/group-by-path/')) {
          return { id: 'group-id' };
        }
        return opts!.query!.first === 0 ? page(100, 0) : page(1, 100);
      }
    );
    await expect(sync(admin)).resolves.toMatchObject({ created: 101 });
  });

  test('rejects when not configured or not permitted', async () => {
    await vpnFixture();
    WG_ENV.ECFK = null;
    await expect(sync(admin)).rejects.toMatchObject({ status: 403 });
    WG_ENV.ECFK = ecfk;
    await expect(sync({ id: 2, role: roles.CLIENT })).rejects.toMatchObject({
      status: 403,
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
