export interface SendArgs {
  toEmail: string;
  toName?: string;
  fromEmail: string;
  fromName?: string;
  subject: string;
  body: string;
  replyToThreadHeader?: string;
}

export type AdapterName = "reachinbox" | "smartlead" | "gmail";

export interface SendResult {
  adapter: AdapterName;
  providerMsgId: string | null;
  status: "sent" | "queued" | "failed";
  errorMessage?: string;
}

export interface EmailAdapter {
  name: AdapterName;
  send(args: SendArgs): Promise<SendResult>;
}
