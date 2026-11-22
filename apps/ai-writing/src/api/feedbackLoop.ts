export type Decision = 'adopt' | 'revise' | 'discard';
export type Outcome = 'unknown' | 'draft' | 'submitted' | 'accepted' | 'rejected' | 'published';
export type Preference = { text: string; format: string };
export type PersonalizationProfile = { enabled: boolean; preferences: Preference[] };
export type FeedbackEvent = {
  id: string; artifactId?: string | null; artifactVersion?: number | null;
  decision: Decision | null; outcome: Outcome; reason: string; note: string;
  manualMinutes: number | null; revenue: number | null; source: 'declared'; createdAt: string;
};
export type FeedbackInput = Partial<Omit<FeedbackEvent, 'id' | 'source' | 'createdAt'>> & { idempotencyKey?: string };
export type FeedbackLoop = {
  projectId: string; events: FeedbackEvent[];
  observed: { userEditCount: number; adoptedCount: number; rollbackCount: number; revisionChars: number | null };
  personalization: PersonalizationProfile & {
    suggestions: { text: string; sources?: {projectId: string; artifactId?: string | null; artifactVersion?: number | null}[]; evidenceCount: number; confidence: number; source: 'explicit_feedback'; format?: string }[];
    context: string;
  };
};
async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE || ''}/api/v1${path}`, {
    method, headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) throw new Error(await response.text() || response.statusText);
  return response.json();
}
export const feedbackApi = {
  overview: (projectId: string) => request<FeedbackLoop>(`/projects/${encodeURIComponent(projectId)}/feedback-loop`),
  submit: (projectId: string, input: FeedbackInput) => request<FeedbackEvent>(`/projects/${encodeURIComponent(projectId)}/feedback-loop`, 'POST', input),
  profile: () => request<PersonalizationProfile>('/personalization/profile'),
  updateProfile: (input: Partial<PersonalizationProfile>) => request<PersonalizationProfile>('/personalization/profile', 'PATCH', input),
  resetProfile: () => request<PersonalizationProfile>('/personalization/profile/reset', 'POST'),
};
