# Creating a GitHub App for an environment

Every environment (local dev, staging, production) needs its **own**
GitHub App — never share one across environments. GitHub locks an App's
callback to one origin, so an App made for staging simply cannot work for
production, the same way a Google Cloud OAuth client is created per
environment/redirect URI.

This takes about 5 minutes per environment. Pick the row below for the one
you're creating, then follow the steps using those exact values.

| | **Staging** | **Production** |
|---|---|---|
| GitHub App name | `ferrous-studio-staging` | `ferrous-studio` |
| Homepage URL | `https://staging.studio.ferrouslabs.co.uk` | `https://studio.ferrouslabs.co.uk` |
| Redirect URI / Setup URL | `https://staging.studio.ferrouslabs.co.uk/api/studio/github/callback` | `https://studio.ferrouslabs.co.uk/api/studio/github/callback` |

## Before you start

Decide **which GitHub account or organisation owns the App** — anyone with
admin rights on that account can install it later.

## Steps

1. Go to **`https://github.com/settings/apps/new`**
   (or, for an organisation-owned App:
   `https://github.com/organizations/<org>/settings/apps/new`).

2. **GitHub App name** — from the table above. Must be unique across all of
   GitHub.

3. **Homepage URL** — from the table above.

4. Scroll to **"Identifying and authorizing users"**:
   - **Redirect URI** — from the table above.
   - Tick **"Request user authorization (OAuth) during installation"** —
     required, the connect flow depends on it.

5. Scroll to **"Post installation"**:
   - Tick **"Redirect on update"** — easy to miss, and without it GitHub
     silently doesn't send the browser back to Ferrous Studio after
     changing which repositories are shared.

6. Scroll to **"Webhook"**:
   - Untick **"Active"** — not used.

7. Scroll to **"Permissions"** → **Repository permissions**:
   - **Contents**: Read and write
   - **Metadata**: Read-only
   - **Pull requests**: Read and write

8. Scroll to the bottom → click **Create GitHub App**.

9. **Make it public — do not skip this step.** By default the App is
   private and can only ever be installed by the account that created it.
   We hit this directly: a second organisation tried to connect and GitHub
   showed them nothing but "this is a private GitHub App," with no way in.

   Fix it now, right after creating the App: go to the **Advanced** tab →
   find **"Make this GitHub App public"** in the red **Danger zone** box →
   click **Make public**.

## Collect the five values Ferrous Studio needs

Still on the App's page:

| Value | Where to find it |
|---|---|
| **App ID** | Top of the **General** tab, under "About" |
| **App slug** | The App's own settings URL: `github.com/settings/apps/<this-part>` |
| **Client ID** | Same "About" section as the App ID |
| **Client secret** | **General** tab → "Client secrets" → **Generate a new client secret** (shown once — copy it immediately) |
| **Private key** | **General** tab → "Private keys" → **Generate a private key** (downloads a `.pem` file) |

The private key needs to travel as one line of text. Convert it:

```bash
base64 -w0 <downloaded-file>.pem
```

## Hand over

Send these 5 values, **labelled with which environment they're for**:

- App ID
- App slug
- Client ID
- Client secret
- Private key (the `base64 -w0` output)

They go into that environment's secrets (`GITHUB_APP_ID`, `GITHUB_APP_SLUG`,
`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_APP_PRIVATE_KEY`) — see
`infra/docs/onboarding-runbook.md` for where those live for staging/prod, or
`backend/.env.local.example` for local dev.

## Repeat for the other environment

Same steps, using the other column of the table at the top. Staging and
production are entirely separate Apps — creating one has no effect on the
other.
