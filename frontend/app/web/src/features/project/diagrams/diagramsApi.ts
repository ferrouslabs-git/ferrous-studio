// Client for a project's diagrams (backend app/studio/diagrams.py). The
// editor saves the whole document with the version it loaded; a 409 means
// someone else saved first.
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "../../../core/api";

export type DiagramKind = "usecase" | "class" | "activity" | "sequence" | "state" | "freeform";

export const DIAGRAM_KINDS: { value: DiagramKind; label: string }[] = [
  { value: "usecase", label: "Use case" },
  { value: "class", label: "Class / entity" },
  { value: "activity", label: "Activity" },
  { value: "sequence", label: "Sequence" },
  { value: "state", label: "State" },
  { value: "freeform", label: "Free-form" },
];

export const diagramKindLabel = (kind: string) => DIAGRAM_KINDS.find((k) => k.value === kind)?.label ?? kind;

export interface DiagramNode {
  id: string;
  type: string;
  label: string;
  stereotype?: string;
  text?: string;
  parentId?: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DiagramEdge {
  id: string;
  type: string;
  label: string;
  source: string;
  target: string;
}

export interface DiagramModel {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface DiagramSummary {
  id: string;
  project_id: string;
  name: string;
  kind: DiagramKind;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface DiagramRecord extends DiagramSummary {
  xml: string;
  model: DiagramModel;
}

const base = (projectId: string) => `/studio/projects/${projectId}/diagrams`;

export const listDiagrams = (projectId: string) => apiGet<DiagramSummary[]>(base(projectId));
export const createDiagram = (projectId: string, input: { name: string; kind: DiagramKind }) =>
  apiPost<DiagramRecord>(base(projectId), input);
export const getDiagram = (projectId: string, diagramId: string) =>
  apiGet<DiagramRecord>(`${base(projectId)}/${diagramId}`);
export const updateDiagram = (projectId: string, diagramId: string, patch: { name?: string; kind?: DiagramKind }) =>
  apiPatch<DiagramSummary>(`${base(projectId)}/${diagramId}`, patch);
export const saveDiagram = (
  projectId: string,
  diagramId: string,
  body: { version: number; xml: string; model: DiagramModel },
) => apiPut<DiagramRecord>(`${base(projectId)}/${diagramId}`, body);
export const deleteDiagram = (projectId: string, diagramId: string) => apiDelete(`${base(projectId)}/${diagramId}`);
