import type { CreateProjectRequest, Page, ProjectDto } from "@kushex/contracts";

export interface ProjectRepository {
  addWorkspace(actorId: string, projectId: string, path: string): Promise<ProjectDto | null>;
  find(actorId: string, id: string): Promise<ProjectDto | null>;
  create(actorId: string, input: CreateProjectRequest): Promise<ProjectDto>;
  list(actorId: string, offset: number): Promise<Page<ProjectDto>>;
}
