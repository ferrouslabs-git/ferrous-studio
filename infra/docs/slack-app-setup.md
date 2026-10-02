# Creating a Slack app for an environment

Every environment (local dev, staging, production) needs its **own** Slack app.
A Slack app's Redirect URL is fixed to one origin, so an app made for staging
cannot work for production.

What the integration does, so you know what you are granting:

- **Updates:** a requirement's status changing, a new feedback report and a new
  comment are posted to one public channel per organisation.
- **Approvals:** an agent holding a board token can ask a person to approve
  something (`request_approval` in `board_mcp.py`). The question is posted with
  **Approve** and **Reject** buttons and the agent polls for the answer.
  Anyone in the channel can press them; the person who did is recorded by their
  Slack name. The server records the decision, it does not enforce it.

| | **Staging** | **Production** |
|---|---|---|
| App name | `Ferrous Studio (staging)` | `Ferrous Studio` |
| Redirect URL | `https://staging.studio.ferrouslabs.co.uk/api/studio/slack/callback` | `https://studio.ferrouslabs.co.uk/api/studio/slack/callback` |
| Interactivity Request URL | `https://staging.studio.ferrouslabs.co.uk/api/studio/slack/interactions` | `https://studio.ferrouslabs.co.uk/api/studio/slack/interactions` |

Local dev: Slack needs a public HTTPS URL for both, so use a tunnel and set
`FRONTEND_URL` to it (the Redirect URL is built from `FRONTEND_URL`).

## Steps

1. Go to **`https://api.slack.com/apps`** → **Create New App** → **From scratch**.
   Name it from the table and pick the workspace you will test in.
2. **OAuth & Permissions**
   - Under **Redirect URLs** add the Redirect URL from the table and save.
   - Under **Bot Token Scopes** add: `chat:write`, `chat:write.public`,
     `channels:read`.
3. **Interactivity & Shortcuts** → switch **Interactivity** on and paste the
   Interactivity Request URL from the table.
4. **Manage Distribution** → **Activate Public Distribution** (needed so
   *other* organisations' workspaces can install it; without it only the
   workspace that owns the app can).
5. **Basic Information** → **App Credentials**: copy the **Client ID**, **Client
   Secret** and **Signing Secret**.

## The fourth value: a token key

`SLACK_TOKEN_KEY` is not from Slack. It is a Fernet key that encrypts each
organisation's bot token in the database. Generate one per environment:

```bash
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep it: if it is lost or changed, every organisation has to reconnect Slack.

## Hand over

The four values, **labelled with which environment they are for**:
`SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`,
`SLACK_TOKEN_KEY`.

They live in Secrets Manager as `ferrous-studio/<env>/SLACK_*` (created by
`infra/terraform/secrets.tf`; set each once by hand with
`aws secretsmanager put-secret-value`). Then add four `SLACK_*` entries to the `secrets` list in
`infra/ecs/taskdef.template.json`, copying the `GITHUB_*` lines. That step is
deliberately not done yet: an ECS task cannot start while a secret it names has
no value, so wire it only for an environment whose four values are set. For local dev see
`backend/.env.local.example`.

## Then, in the app

An organisation admin opens **Organisation ▸ Slack** (platform admins: the
**Slack** action on Administration ▸ Organisations), presses **Connect Slack**,
allows the app, and chooses a channel. A short message appears in the channel to
show it works.
