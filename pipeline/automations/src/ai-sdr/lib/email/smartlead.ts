import type { EmailAdapter, SendArgs, SendResult } from "./types.js";

/**
 * Smartlead adapter.
 *
 * Smartlead requires that the recipient already exist as a "lead" inside a
 * campaign. The flow is: (1) add lead to campaign, (2) Smartlead's sending
 * scheduler picks it up. We can't send a one-off transactional email.
 *
 * Phase 1: stub. Phase 2: implement against
 *   POST /api/v1/leads/{campaign_id}
 *   GET  /api/v1/leads/{lead_id}/email-stats
 *
 * Docs: https://docs.smartlead.ai
 */
export const smartleadAdapter: EmailAdapter = {
  name: "smartlead",

  async send(args: SendArgs): Promise<SendResult> {
    const apiKey = process.env.SMARTLEAD_API_KEY;
    const campaignId = process.env.SMARTLEAD_CAMPAIGN_ID;

    if (!apiKey || !campaignId) {
      return {
        adapter: "smartlead",
        providerMsgId: null,
        status: "failed",
        errorMessage:
          "SMARTLEAD_API_KEY or SMARTLEAD_CAMPAIGN_ID not set (Phase 2 wire-up pending)",
      };
    }

    // TODO Phase 2:
    // 1. POST /api/v1/leads/{campaign_id} with lead_input containing
    //    first_name, last_name, email, custom_fields { subject, body }
    // 2. Smartlead campaign template references {{subject}} / {{body}} so
    //    the variant content flows through the campaign's sending schedule.
    // 3. Return lead_id as providerMsgId.

    void args;
    return {
      adapter: "smartlead",
      providerMsgId: null,
      status: "failed",
      errorMessage: "Smartlead send() not implemented yet (Phase 2)",
    };
  },
};
