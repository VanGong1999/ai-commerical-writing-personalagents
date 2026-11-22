import { queryOptions } from "@tanstack/react-query";
import { api } from "../../api/client";

export const ownerBotsQuery = queryOptions({
  queryKey: ["bots"],
  queryFn: () => api.listBots({ includeArchived: true }),
});
