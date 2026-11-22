import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams } from "@tanstack/react-router";
import { useEffect } from "react";
import { api } from "../../api/client";

export function ProjectRedirect() {
  const { id } = useParams({ from: "/projects/$id" });
  const { data, isError, isLoading } = useQuery({
    queryKey: ["project", id],
    queryFn: () => api.getProject(id),
  });

  useEffect(() => {
    if (!data?.id) return;
    void api.patchProject(data.id, { lastOpenedAt: new Date().toISOString() }).catch(() => {});
  }, [data?.id]);

  if (isLoading) return <div className="page">打开项目…</div>;
  if (isError || !data) return <div className="page">项目不存在</div>;

  return (
    <Navigate
      to="/studio/$format"
      params={{ format: data.format }}
      search={{ projectId: data.id }}
    />
  );
}
