// Client for a project's use case model (backend app/studio/use_cases.py):
// actors are the user types, use cases are the actions they can perform.
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export interface UseCaseActor {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  pos: string;
  created_at: string;
  updated_at: string;
}

export type UseCaseActorInput = Pick<UseCaseActor, "name" | "description">;

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
