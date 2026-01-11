import { toWebRequest } from "h3";

import { auth } from "@@/utils/auth";

export default defineEventHandler(async (event) => {
  const request = toWebRequest(event);
  const session = await auth.api.getSession({
    headers: request.headers,
  });

  return { session };
});
