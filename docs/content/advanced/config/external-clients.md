---
title: External Clients from Keycloak
---

wg-easy can create clients from the members of a Keycloak group. When all of
the environment variables below are set, a **Sync External Clients** button
appears next to **New Client**.

| Env                  | Required           | Example                              | Description                                      |
| -------------------- | ------------------ | ------------------------------------ | ------------------------------------------------ |
| `ECFK_SERVER`        | :white_check_mark: | `https://kc.example.com/realms/acme` | Realm URL containing the users and group         |
| `ECFK_CLIENT_ID`     | :white_check_mark: | `wg-easy-sync`                       | Keycloak client used for the sync                |
| `ECFK_CLIENT_SECRET` | :white_check_mark: | `secret`                             | Secret of that Keycloak client                   |
| `ECFK_TARGET_GROUP`  | :white_check_mark: | `vpn-users`                          | Name of a **top-level** group to sync users from |

## Keycloak Setup

wg-easy signs in to Keycloak as a service account, so it needs its own
Keycloak client. Create it in the realm used in `ECFK_SERVER`:

1. Go to **Clients** → **Create client** and set the **Client ID** to the value
   of `ECFK_CLIENT_ID`.
2. Under **Capability config**, turn on **Client authentication** and tick
   **Service accounts roles**. The other flows (e.g. **Standard flow**) can be
   turned off, as nobody logs in through this client.
3. Save. Copy the secret from the **Credentials** tab into
   `ECFK_CLIENT_SECRET`.
4. On the **Service account roles** tab, click **Assign role**, switch the
   filter to **Filter by clients**, and assign `view-users` from
   `realm-management`.
5. On Keycloak 26.8.2 and later, open the **Client scopes** tab, click
   **Add client scope**, and add `kc-admin-api` as **Default**. Newer versions
   reject Admin API tokens that lack this scope.

/// note | Service account roles tab missing?

The **Credentials** and **Service account roles** tabs only appear after
**Client authentication** and **Service accounts roles** are enabled and
saved. Reload the page if they still don't show.

///

### Required Permission

The only role needed is the `realm-management` client role `view-users`. It
includes `query-users` and `query-groups`, which covers every call the sync
makes:

| Request                                            | Purpose                                   |
| -------------------------------------------------- | ----------------------------------------- |
| `POST <ECFK_SERVER>/protocol/openid-connect/token` | Get an access token (client credentials)  |
| `GET /admin/realms/<realm>/group-by-path/<group>`  | Find the top-level group                  |
| `GET /admin/realms/<realm>/groups/<id>/members`    | List members and whether they are enabled |

The sync never writes to Keycloak, so don't grant `manage-users` or
`realm-admin`.

### Troubleshooting

| Error from the sync              | Cause                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `401` on the token request       | Wrong `ECFK_CLIENT_ID` / `ECFK_CLIENT_SECRET`, or **Client authentication** is off                                                                           |
| `401` on an `/admin/...` request | The `kc-admin-api` client scope is not assigned as **Default** (Keycloak 26.8.2+). Keycloak's debug log shows `Expected audience not available in the token` |
| `403` on an `/admin/...` request | `view-users` is not assigned, or it was assigned as a realm role instead of a client role                                                                    |
| `404` on `group-by-path`         | `ECFK_TARGET_GROUP` doesn't exactly match a top-level group name (case-sensitive)                                                                            |
| `404` on the token request       | `ECFK_SERVER` points at the wrong realm or host                                                                                                              |

## Sync Behavior

Each sync manages clients named `kc_<username>`:

| Keycloak                  | wg-easy client                  |
| ------------------------- | ------------------------------- |
| Enabled member, no client | `kc_<username>` is created      |
| Member disabled           | Client is disabled              |
| Member re-enabled         | Client is enabled               |
| Removed from the group    | Client is deleted               |
| Username changed          | Old client deleted, new created |

/// warning | The `kc_` prefix is reserved

Any client whose name starts with `kc_` is treated as synced, including ones
created by hand. Keycloak always wins: a `kc_` client disabled manually is
re-enabled on the next sync while the user is enabled in Keycloak. Expired
clients are not re-enabled.

///

Only direct members of the group are synced, not members of subgroups.
