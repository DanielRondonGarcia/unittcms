import { DataTypes } from 'sequelize';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import defineMember from '../models/members.js';
import defineOrganization from '../models/organizations.js';
import defineProject from '../models/projects.js';

type Extra = { authInfo?: { scopes?: string[]; extra?: { userId?: number } } };
type Handler = (args: Record<string, any>, extra: Extra) => Promise<Record<string, unknown>>;
const text = (value: unknown) => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
const failed = (error: unknown) => ({
  content: [{ type: 'text', text: error instanceof Error ? error.message : 'MCP operation failed' }],
  isError: true,
});
const denied = (scope: string) => ({
  content: [{ type: 'text', text: `insufficient_scope: ${scope} scope required` }],
  isError: true,
});
const plain = (value: any) => value?.get?.({ plain: true }) ?? value?.toJSON?.() ?? value;

function caller(extra: Extra): number {
  const id = Number(extra.authInfo?.extra?.userId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('unauthenticated');
  return id;
}

export function registerScopedTool(
  server: McpServer,
  name: string,
  scope: 'read' | 'write',
  config: Record<string, any>,
  handler: Handler
): void {
  (server as any).registerTool(
    name,
    { ...config, inputSchema: config.inputSchema ?? {} },
    async (args: any, extra: Extra) => {
      if (!extra.authInfo?.scopes?.includes(scope)) return denied(scope);
      try {
        return await handler(args ?? {}, extra);
      } catch (error) {
        return failed(error);
      }
    }
  );
}

export function registerMcpOperations(server: McpServer, sequelize: any): void {
  const Project = defineProject(sequelize, DataTypes) as any;
  const Member = defineMember(sequelize, DataTypes) as any;
  const Organization = defineOrganization(sequelize, DataTypes) as any;
  const visible = async (projectId: number, userId: number) => {
    const project = await Project.findByPk(projectId);
    return Boolean(
      project &&
        (project.isPublic ||
          Number(project.userId) === userId ||
          (await Member.findOne({ where: { projectId, userId } })))
    );
  };
  const editable = async (projectId: number, userId: number) => {
    const project = await Project.findByPk(projectId);
    if (!project) return false;
    if (Number(project.userId) === userId) return true;
    const member = await Member.findOne({ where: { projectId, userId } });
    return Boolean(member && Number(member.role) <= 1);
  };
  const add = (name: string, scope: 'read' | 'write', config: Record<string, any>, handler: Handler) =>
    registerScopedTool(server, name, scope, config, handler);

  add(
    'get_project',
    'read',
    { description: 'Read one visible project', inputSchema: { projectId: z.number().int().positive() } },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = Number(args.projectId);
      const project = await Project.findByPk(projectId);
      if (!project || !(await visible(projectId, userId))) throw new Error('project_not_found');
      return text(plain(project));
    }
  );
  add(
    'create_project',
    'write',
    {
      description: 'Create a project owned by the caller',
      inputSchema: {
        name: z.string().trim().min(1).max(200),
        detail: z.string().optional(),
        isPublic: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const [organization] = await Organization.findOrCreate({
        where: { ownerUserId: userId },
        defaults: { name: `Organization ${userId}`, ownerUserId: userId },
      });
      return text(
        plain(
          await Project.create({
            name: args.name,
            detail: args.detail ?? null,
            isPublic: args.isPublic ?? false,
            userId,
            organizationId: organization.id,
          })
        )
      );
    }
  );
  add(
    'update_project',
    'write',
    {
      description: 'Update a project owned by the caller',
      inputSchema: {
        projectId: z.number().int().positive(),
        name: z.string().trim().min(1).max(200).optional(),
        detail: z.string().optional(),
        isPublic: z.boolean().optional(),
      },
    },
    async (args, extra) => {
      const userId = caller(extra);
      const projectId = Number(args.projectId);
      if (!(await editable(projectId, userId))) throw new Error('project_write_forbidden');
      const project = await Project.findByPk(projectId);
      if (!project) throw new Error('project_not_found');
      await project.update(
        Object.fromEntries(
          ['name', 'detail', 'isPublic'].filter((key) => args[key] !== undefined).map((key) => [key, args[key]])
        )
      );
      return text(plain(project));
    }
  );
}
