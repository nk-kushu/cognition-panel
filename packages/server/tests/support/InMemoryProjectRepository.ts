import { randomUUID } from "node:crypto";
import type { CreateProjectRequest, Page, ProjectDto } from "@kushex/contracts";
import type { ProjectRepository } from "../../src/modules/projects/public.js";
import type { Workspace, WorkspaceRepository } from "../../src/modules/workspaces/public.js";

export class InMemoryProjectRepository implements ProjectRepository, WorkspaceRepository {
  private readonly records = new Map<string, { actorId: string; project: ProjectDto }>();
  async create(actorId: string, input: CreateProjectRequest): Promise<ProjectDto> {
    const workspace = { id: randomUUID(), path: input.path, branch: null, revision: null };
    const project: ProjectDto = {
      id: randomUUID(),
      name: input.name,
      description: input.description ?? null,
      createdAt: new Date().toISOString(),
      workspace,
      workspaces: [workspace],
    };
    this.records.set(project.id, { actorId, project });
    return project;
  }
  async addWorkspace(actorId: string, projectId: string, path: string): Promise<ProjectDto | null> {
    const project = await this.find(actorId, projectId);
    if (!project) return null;
    const updated = {
      ...project,
      workspaces: [...project.workspaces, { id: randomUUID(), path, branch: null, revision: null }],
    };
    this.records.set(projectId, { actorId, project: updated });
    return updated;
  }
  async find(actorId: string, id: string): Promise<ProjectDto | null> {
    const record = this.records.get(id);
    return record?.actorId === actorId ? record.project : null;
  }
  async list(actorId: string, _offset: number): Promise<Page<ProjectDto>> {
    return {
      entries: [...this.records.values()]
        .filter((record) => record.actorId === actorId)
        .map((record) => record.project),
      nextOffset: null,
    };
  }
  async findForProject(
    projectId: string,
    actorId: string,
    workspaceId?: string,
  ): Promise<Workspace | null> {
    const project = await this.find(actorId, projectId);
    const workspace = workspaceId
      ? project?.workspaces.find((item) => item.id === workspaceId)
      : project?.workspace;
    return workspace ? { ...workspace, projectId } : null;
  }
}
