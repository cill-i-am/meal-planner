const lostResponseOrganization =
  "organization-batch-queue-send-ambiguous-proof";

export default function makeQueueWithLostResponses(environment) {
  return {
    async send(body, options) {
      await environment.ACCEPTED_QUEUE.send(body, options);
      if (body.organizationId === lostResponseOrganization) {
        throw new Error("Queue response lost after acceptance");
      }
    },
  };
}
