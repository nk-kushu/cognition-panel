import type { CreateProjectRequest, Page, ProjectDto } from "@kushex/contracts";
import type { PrismaClient, Prisma } from "../../../generated/prisma/client.js";
import type { ProjectRepository } from "../application/ProjectRepository.js";

export class PrismaProjectRepository implements ProjectRepository {
  private readonly pageSize = 100;
  constructor(private readonly client: PrismaClient) {}
  async find(actorId: string, id: string): Promise<ProjectDto | null> {
    const row = await this.client.project.findFirst({
      where: { id, actorId },
      include: { workspaces: true },
    });
    return row ? this.toDto(row) : null;
  }
  async create(actorId: string, input: CreateProjectRequest): Promise<ProjectDto> {
    // Nested create is atomic: a workspace cannot be committed without its project.
    const project = await this.client.project.create({
      data: {
        actorId,
        name: input.name,
        description: input.description ?? null,
        workspaces: { create: { path: input.path } },
      },
      include: { workspaces: true },
    });
    return this.toDto(project);
  }
  async list(actorId: string, offset: number): Promise<Page<ProjectDto>> {
    const rows = await this.client.project.findMany({
      where: { actorId },
      include: { workspaces: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: offset,
      take: this.pageSize + 1,
    });
    return {
      entries: rows.slice(0, this.pageSize).map((row) => this.toDto(row)),
      nextOffset: rows.length > this.pageSize ? offset + this.pageSize : null,
    };
  }
  async addWorkspace(actorId: string, projectId: string, path: string): Promise<ProjectDto | null> {
    if (!(await this.find(actorId, projectId))) return null;
    await this.client.workspace.create({ data: { projectId, path } });
    return this.find(actorId, projectId);
  }
  private toDto(project: Prisma.ProjectGetPayload<{ include: { workspaces: true } }>): ProjectDto {
    if (!project.workspaces[0]) throw new Error("Project is missing its workspace.");
    const { id, name, description, createdAt } = project;
    const workspaces = [...project.workspaces]
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
      .map(({ id, path, branch, revision }) => ({ id, path, branch, revision }));
    return {
      id,
      name,
      description,
      createdAt: createdAt.toISOString(),
      workspace: workspaces[0]!,
      workspaces,
    };
  }
}
