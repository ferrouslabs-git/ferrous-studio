// Client for a project's personas (backend app/studio/personas.py).
import { apiDelete, apiGet, apiPatch, apiPost } from "../../../core/api";

export interface Persona {
  id: string;
  project_id: string;
  name: string;
  role: string | null;
  primary_interface: string | null;
  traits: string[];
  jobs_to_be_done: string[];
  pain_points: string[];
  feelings: string[];
  notes: string | null;
  pos: string;
  created_at: string;
  updated_at: string;
}

export type PersonaInput = Pick<
  Persona,
  "name" | "role" | "primary_interface" | "traits" | "jobs_to_be_done" | "pain_points" | "feelings" | "notes"
>;

/** Suggestions for the free-text interface field. */
export const INTERFACE_SUGGESTIONS = ["Desktop", "Tablet", "Mobile", "Kiosk", "Voice", "API"];

const base = (projectId: string) => `/studio/projects/${projectId}/personas`;

export const listPersonas = (projectId: string) => apiGet<Persona[]>(base(projectId));
export const createPersona = (projectId: string, input: PersonaInput) => apiPost<Persona>(base(projectId), input);
export const updatePersona = (projectId: string, personaId: string, patch: Partial<PersonaInput>) =>
  apiPatch<Persona>(`${base(projectId)}/${personaId}`, patch);
export const deletePersona = (projectId: string, personaId: string) => apiDelete(`${base(projectId)}/${personaId}`);
