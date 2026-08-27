import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import {
  Body,
  Controller,
  Get,
  Header,
  Path,
  Post,
  Query,
  Request,
  Route,
  Security,
  SuccessResponse,
  Tags,
} from 'tsoa';
import type { Request as ExpressRequest } from 'express';
import { SECRET_KEY } from '../config/config.js';
import {
  AutomationError,
  createAutomationApplication,
  type AutomationApplication,
} from '../automation/application/service.js';
import { NeutralExecutorRegistry } from '../automation/ports/registry.js';
import type {
  CreateAutomationExecutionRequest,
  AutomationErrorResponse,
  AutomationResponse,
} from '../automation/api/dto.js';

let application: AutomationApplication = createAutomationApplication({ registry: new NeutralExecutorRegistry() });
export function configureAutomationApplication(next: AutomationApplication): void {
  application = next;
}
export function getAutomationApplication(): AutomationApplication {
  return application;
}

function authenticatedUser(request: ExpressRequest): number {
  const assigned = Number((request as ExpressRequest & { userId?: unknown }).userId);
  if (Number.isInteger(assigned) && assigned > 0) return assigned;
  try {
    const token = request.header('Authorization')?.split(' ').pop();
    if (!token) throw new Error('missing token');
    const decoded = jwt.verify(token, SECRET_KEY);
    const userId = Number(typeof decoded === 'object' && decoded ? decoded.userId : NaN);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('invalid token');
    return userId;
  } catch {
    throw new AutomationError(401, 'unauthenticated');
  }
}
function correlationId(request: ExpressRequest): string {
  const value = request.header('X-Correlation-Id');
  return value && /^[a-zA-Z0-9._:-]{1,128}$/.test(value) ? value : randomUUID();
}

@Route('automation')
@Tags('automation')
export class AutomationController extends Controller {
  private readonly service: AutomationApplication;
  constructor(service: AutomationApplication = application) {
    super();
    this.service = service;
  }
  private async handle(
    request: ExpressRequest,
    action: (userId: number, correlationId: string) => Promise<AutomationResponse>
  ): Promise<AutomationResponse> {
    const id = correlationId(request);
    try {
      return await action(authenticatedUser(request), id);
    } catch (error) {
      const result = this.service.safeError(error, id);
      this.setStatus(result.status);
      return result.body as AutomationErrorResponse;
    }
  }

  @Post('executions')
  @Security('jwt')
  @SuccessResponse('202', 'Execution queued')
  public async createExecution(
    @Request() request: ExpressRequest,
    @Body() body: CreateAutomationExecutionRequest,
    @Header('Idempotency-Key') headerKey?: string
  ): Promise<AutomationResponse> {
    return this.handle(request, (userId, correlationId) =>
      this.service.create({ ...body, userId, correlationId, idempotencyKey: headerKey ?? body.idempotencyKey ?? '' })
    );
  }

  @Get('executions/{executionId}')
  @Security('jwt')
  public async getExecution(
    @Request() request: ExpressRequest,
    @Path() executionId: string
  ): Promise<AutomationResponse> {
    return this.handle(request, (userId) => this.service.detail(userId, executionId));
  }

  @Get('projects/{projectId}/executions')
  @Security('jwt')
  public async getHistory(
    @Request() request: ExpressRequest,
    @Path() projectId: number,
    @Query() page = 1,
    @Query() limit = 20,
    @Query() status?: string,
    @Query() caseId?: number,
    @Query() runCaseId?: number
  ): Promise<AutomationResponse> {
    return this.handle(request, (userId) =>
      this.service.history({ userId, projectId, page, limit, status, caseId, runCaseId })
    );
  }

  @Get('projects/{projectId}/environments')
  @Security('jwt')
  public async getEnvironments(
    @Request() request: ExpressRequest,
    @Path() projectId: number
  ): Promise<AutomationResponse> {
    return this.handle(request, (userId) =>
      this.service.environments({ userId, projectId }).then((items) => ({ items }))
    );
  }

  @Post('executions/{executionId}/cancel')
  @Security('jwt')
  public async cancelExecution(
    @Request() request: ExpressRequest,
    @Path() executionId: string
  ): Promise<AutomationResponse> {
    return this.handle(request, (userId) => this.service.cancel({ userId, executionId }));
  }

  @Get('executions/{executionId}/artifacts')
  @Security('jwt')
  public async getArtifacts(
    @Request() request: ExpressRequest,
    @Path() executionId: string
  ): Promise<AutomationResponse> {
    return this.handle(request, (userId) => this.service.artifacts(userId, executionId).then((items) => ({ items })));
  }

  @Get('artifacts/{artifactId}/download')
  @Security('jwt')
  public async downloadArtifact(
    @Request() request: ExpressRequest,
    @Path() artifactId: string
  ): Promise<AutomationResponse> {
    return this.handle(request, (userId) => this.service.download(userId, artifactId));
  }

  @Get('executors')
  @Security('jwt')
  public async getExecutors(@Request() request: ExpressRequest): Promise<AutomationResponse> {
    return this.handle(request, () => this.service.executors().then((items) => ({ items })));
  }

  @Get('health')
  @Security('jwt')
  public async getHealth(@Request() request: ExpressRequest): Promise<AutomationResponse> {
    return this.handle(request, async () => {
      const result = await this.service.health();
      if (!result.ready) this.setStatus(503);
      return result;
    });
  }
}
