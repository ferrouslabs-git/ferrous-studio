// Client for /api/studio/slack/* (backend app/studio/slack.py).
//
// One connection per organisation, made by an admin. Installing the Slack app
// leaves the app entirely -- `startConnect` returns a URL for the browser to
// navigate to, and Slack sends the user back to Organisation ▸ Slack with a
// ?slack= outcome (see CONNECT_OUTCOMES below).
import { apiDelete, apiGet, apiPost, apiPut } from "../../core/api";

export interface SlackConnection {
  /** Whether this deployment has a Slack app at all. */
  configured: boolean;
  connected: boolean;
  /** The environment variables an unconfigured deployment lacks. */
  missing: string[];
  team_name: string | null;
  channel_id: string | null;
  channel_name: string | null;
  connected_at: string | null;
  connected_by: string | null;
}

export interface SlackChannel {
  id: string;
  name: string;
}

export const getSlackConnection = () => apiGet<SlackConnection>("/studio/slack/connection");

/** A URL rather than a redirect: this call carries the bearer token, and
 *  following a redirect with fetch would forward it to slack.com. */
export const startSlackConnect = () => apiPost<{ url: string }>("/studio/slack/connect", {});

export const listSlackChannels = () => apiGet<SlackChannel[]>("/studio/slack/channels");

export const setSlackChannel = (channelId: string) =>
  apiPut<SlackConnection>("/studio/slack/channel", { channel_id: channelId });

export const disconnectSlack = () => apiDelete("/studio/slack/connection");

/** What the ?slack= parameter on the return trip means. Anything unrecognised
 *  is ignored rather than shown, since the query string is editable. */
export const CONNECT_OUTCOMES: Record<string, { tone: "ok" | "warn"; message: string }> = {
  connected: { tone: "ok", message: "Slack connected. Choose a channel to start receiving updates." },
  cancelled: { tone: "warn", message: "Slack was not connected." },
  failed: { tone: "warn", message: "Slack could not complete the connection." },
};
