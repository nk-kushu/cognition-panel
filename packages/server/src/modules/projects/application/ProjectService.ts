import { NotFoundError } from "../../../errors/NotFoundError.js";
import type { CreateProjectRequest, Page, ProjectDto } from "@kushex/contracts";
import type { RequestContext } from "../../../shared/application/RequestContext.js";
import type { WorkspaceService } from "../../workspaces/public.js";
import type { ProjectRepository } from "./ProjectRepository.js";

export class ProjectService {
  private readonly opening = new Map<string, Promise<{ project: ProjectDto; created: boolean }>>();
  constructor(
    private readonly repository: ProjectRepository,
    private readonly workspaces: WorkspaceService,
  ) {}
  async find(context: RequestContext, id: string): Promise<ProjectDto> {
    const project = await this.repository.find(context.actor.id, id);
    if (!project) throw new NotFoundError("Project not found.");
    return project;
  }
  async create(context: RequestContext, input: CreateProjectRequest): Promise<ProjectDto> {
    await this.workspaces.validateLocation(context, input.path);
    return this.repository.create(context.actor.id, input);
  }
  /** Reuse the project already opened at `input.path`, or create it; `created` tells which. */
  async open(
    context: RequestContext,
    input: CreateProjectRequest,
  ): Promise<{ project: ProjectDto; created: boolean }> {
    // Concurrent opens of one path (a host remounting the panel) share one lookup-or-create.
    const key = JSON.stringify([context.actor.id, input.path]);
    const pending = this.opening.get(key);
    if (pending) return { project: (await pending).project, created: false };
    const opening = this.findOrCreate(context, input);
    this.opening.set(key, opening);
    try {
      return await opening;
    } finally {
      this.opening.delete(key);
    }
  }
  private async findOrCreate(
    context: RequestContext,
    input: CreateProjectRequest,
  ): Promise<{ project: ProjectDto; created: boolean }> {
    await this.workspaces.validateLocation(context, input.path);
    const existing = await this.repository.findByWorkspacePath(context.actor.id, input.path);
    if (existing) return { project: existing, created: false };
    return { project: await this.repository.create(context.actor.id, input), created: true };
  }
  async addWorkspace(
    context: RequestContext,
    projectId: string,
    path: string,
  ): Promise<ProjectDto> {
    await this.find(context, projectId);
    await this.workspaces.validateLocation(context, path);
    const project = await this.repository.addWorkspace(context.actor.id, projectId, path);
    if (!project) throw new NotFoundError("Project not found.");
    return project;
  }
  list(context: RequestContext, offset: number): Promise<Page<ProjectDto>> {
    return this.repository.list(context.actor.id, offset);
  }
}
