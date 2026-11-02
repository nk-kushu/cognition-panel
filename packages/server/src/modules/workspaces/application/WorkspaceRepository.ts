import type { Workspace } from "../domain/Workspace.js";

export interface WorkspaceRepository {
  findForProject(
    projectId: string,
    actorId: string,
    workspaceId?: string,
  ): Promise<Workspace | null>;
}
