import { encodeBagTag } from "@/services/bags/taggingClient";

/**
 * @deprecated This compatibility facade deliberately exposes no browser
 * lifecycle authority.  New code must use domain hooks and server APIs.
 */
function removed(): never {
  throw new Error(
    "Browser bag lifecycle authority was removed. Use an authenticated server mutation.",
  );
}

export const bagService = {
  async encodeTag(bagId: string, epc: string) {
    return await encodeBagTag(bagId, epc);
  },
  flagSuspect: async (_input: unknown) => removed(),
  registerRead: async (_bagId: string, _zone: string, _readerId: string) => removed(),
  sendToRecheck: async (_bagId: string, _officer: string) => removed(),
  resolve: async (_bagId: string, _input: unknown) => removed(),
};
