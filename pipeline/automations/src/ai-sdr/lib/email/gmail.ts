import type { EmailAdapter, SendArgs, SendResult } from "./types.js";

/**
 * Gmail API adapter (OAuth refresh-token flow).
 *
 * Sends via the user's own mailbox (warm domain) for high deliverability on
 * named/enterprise accounts. Subject to Gmail's per-user send limits
 * (~500/day for free, 2000/day for Workspace).
 *
 * Phase 1: stub. Phase 2: implement against
 *   POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send
 *
 * Auth: refresh-token-based OAuth (no interactive consent at runtime).
 */
export const gmailAdapter: EmailAdapter = {
  name: "gmail",

  async send(args: SendArgs): Promise<SendResult> {
    const clientId = process.env.GMAIL_OAUTH_CLIENT_ID;
    const clientSecret = process.env.GMAIL_OAUTH_CLIENT_SECRET;
    const refreshToken = process.env.GMAIL_OAUTH_REFRESH_TOKEN;
    const fromAddress = process.env.GMAIL_FROM_ADDRESS;

    if (!clientId || !clientSecret || !refreshToken || !fromAddress) {
      return {
        adapter: "gmail",
        providerMsgId: null,
        status: "failed",
        errorMessage:
          "Gmail OAuth env vars not set (Phase 2 wire-up pending)",
      };
    }

    // TODO Phase 2:
    // 1. Exchange refresh_token → access_token via oauth2.googleapis.com/token
    // 2. Build RFC 2822 message:
    //      From: {fromName} <{fromAddress}>
    //      To: {toName} <{toEmail}>
    //      Subject: {subject}
    //      [thread headers if reply]
    //      <blank line>
    //      {body}
    // 3. base64url-encode the raw message
    // 4. POST gmail/v1/users/me/messages/send { raw: encoded }
    // 5. Return response.id as providerMsgId.

    void args;
    return {
      adapter: "gmail",
      providerMsgId: null,
      status: "failed",
      errorMessage: "Gmail send() not implemented yet (Phase 2)",
    };
  },
};
