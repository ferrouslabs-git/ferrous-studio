// Client for a project's use case model (backend app/studio/use_cases.py):
// actors are what sits outside the system, use cases are what the system
// offers. Neither side is required by the other -- an actor with nothing to
// do yet is fine, and so is a use case with no actor (something the system
// does of its own accord).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

/** What an actor is, not just what it is called. The diagram draws one glyph
 *  per kind, so this is the whole vocabulary. */
export type UseCaseActorKind = "person" | "system" | "time";

export const ACTOR_KINDS: { id: UseCaseActorKind; label: string; hint: string }[] = [
  { id: "person", label: "Person", hint: "a role someone plays — Customer, Administrator" },
  { id: "system", label: "System", hint: "another system this one talks to — a payment gateway" },
  { id: "time", label: "Time", hint: "a schedule or elapsed time — the nightly run, a 30-day expiry" },
];

export const ACTOR_KIND_LABEL: Record<UseCaseActorKind, string> = {
  person: "Person",
  system: "System",
  time: "Time",
};

export interface UseCaseActor {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  kind: UseCaseActorKind;
  pos: string;
  created_at: string;
  updated_at: string;
}

export type UseCaseActorInput = Pick<UseCaseActor, "name" | "description" | "kind">;

export interface UseCase {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  /** Ids of the actors who can perform this use case. */
  actor_ids: string[];
  pos: string;
  created_at: string;
  updated_at: string;
}

export type UseCaseInput = Pick<UseCase, "name" | "description" | "actor_ids">;

const actorsBase = (projectId: string) => `/studio/projects/${projectId}/use-case-actors`;
const useCasesBase = (projectId: string) => `/studio/projects/${projectId}/use-cases`;

export const listActors = (projectId: string) => apiGet<UseCaseActor[]>(actorsBase(projectId));
export const createActor = (projectId: string, input: UseCaseActorInput) =>
  apiPost<UseCaseActor>(actorsBase(projectId), input);
export const updateActor = (projectId: string, actorId: string, patch: Partial<UseCaseActorInput>) =>
  apiPatch<UseCaseActor>(`${actorsBase(projectId)}/${actorId}`, patch);
export const deleteActor = (projectId: string, actorId: string) => apiDelete(`${actorsBase(projectId)}/${actorId}`);

export const listUseCases = (projectId: string) => apiGet<UseCase[]>(useCasesBase(projectId));
export const createUseCase = (projectId: string, input: UseCaseInput) => apiPost<UseCase>(useCasesBase(projectId), input);
export const updateUseCase = (projectId: string, useCaseId: string, patch: Partial<UseCaseInput>) =>
  apiPatch<UseCase>(`${useCasesBase(projectId)}/${useCaseId}`, patch);
export const deleteUseCase = (projectId: string, useCaseId: string) =>
  apiDelete(`${useCasesBase(projectId)}/${useCaseId}`);
