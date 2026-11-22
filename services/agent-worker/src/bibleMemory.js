import { api } from './apiClient.js';

/** Skills store bible under bible/; keep older project-root files readable. */
export async function readProjectBible(projectId, fileName, client = api, { strictMissing = false } = {}) {
  for (const directory of ['bible/', '']) {
    const file = await client.getMemoryFile(`/memories/projects/${projectId}/${directory}${fileName}`)
      .catch(error => {
        const status = error?.status ?? error?.statusCode ?? error?.response?.status;
        const missing = status === 404 || /^404(?:\s|$)/.test(String(error?.message || ''));
        if (strictMissing && !missing) throw error;
        return null;
      });
    if (String(file?.content || file?.body || '').trim()) return file;
  }
  return null;
}
