import { WorkerEntrypoint } from "cloudflare:workers";

const lostResponseOrganization =
  "organization-batch-queue-send-ambiguous-proof";

export default class QueueWithLostResponses extends WorkerEntrypoint {
  async send(body, options) {
    await this.env.ACCEPTED_QUEUE.send(body, options);
    if (body.organizationId === lostResponseOrganization) {
      throw new Error("Queue response lost after acceptance");
    }
  }
}
