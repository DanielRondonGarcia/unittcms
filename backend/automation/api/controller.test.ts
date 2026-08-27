import { describe, expect, it, vi } from 'vitest';
import { AutomationController } from '../../controllers/AutomationController.js';
import { createAutomationApplication } from '../application/service.js';
import { EnvironmentResolver } from '../infrastructure/environment.js';
import { NeutralExecutorRegistry } from '../ports/registry.js';

const request = {
  userId: 1,
  header: vi.fn((name: string) => (name === 'X-Correlation-Id' ? 'corr-1' : undefined)),
} as never;

describe('automation controller contract', () => {
  it('rejects missing JWTs with the safe correlated error shape', async () => {
    const unauthenticated = { header: vi.fn(() => undefined) } as never;
    const response = await new AutomationController().getHealth(unauthenticated);

    expect(response).toEqual({ error: 'unauthenticated', correlationId: expect.any(String) });
  });

  it('keeps the production route explicitly not-ready until a queue is injected', async () => {
    const response = await new AutomationController().createExecution(request, {
      projectId: 10,
      caseId: 7,
      environmentId: 3,
      idempotencyKey: 'k',
    });

    expect(response).toEqual({ error: 'automation_not_ready', correlationId: 'corr-1' });
  });

  it('accepts an injected application without exposing client-controlled final status', async () => {
    const store = {
      findCase: vi.fn(async () => ({
        id: 7,
        projectId: 10,
        title: 'Login',
        Steps: [
          { step: 'signed out', caseSteps: { stepNo: 1, keyword: 'given' } },
          { step: 'login form', caseSteps: { stepNo: 2, keyword: 'when' } },
          { step: 'dashboard', caseSteps: { stepNo: 3, keyword: 'then' } },
        ],
      })),
      canAccessProject: vi.fn(async () => true),
      findExecutionByIdempotencyKey: vi.fn(async () => null),
      findEnvironment: vi.fn(async () => ({
        id: 3,
        projectId: 10,
        enabled: true,
        baseUrl: 'https://example.test',
        allowedHosts: ['example.test'],
        secretRefs: [],
      })),
      createDefinition: vi.fn(async (value) => ({ id: 1, ...value })),
      createExecution: vi.fn(async (value) => ({ id: 'e1', ...value })),
    } as never;
    const queue = { enqueue: vi.fn(async () => 'job-1'), cancel: vi.fn() };
    const app = createAutomationApplication({
      store,
      queue,
      registry: new NeutralExecutorRegistry(),
      environmentResolver: new EnvironmentResolver(async () => ({
        baseUrl: 'https://example.test',
        allowedHosts: ['example.test'],
        secretRefs: [],
      })),
    });
    const response = await new AutomationController(app).createExecution(
      request,
      { projectId: 10, caseId: 7, environmentId: 3, idempotencyKey: 'k' },
      'k'
    );

    expect(response).toMatchObject({ status: 'queued' });
    expect(queue.enqueue).toHaveBeenCalledOnce();
  });

  it('exposes project-scoped environment metadata without connection details', async () => {
    const app = createAutomationApplication({
      store: {
        canAccessProject: vi.fn(async () => true),
        listEnvironments: vi.fn(async () => [
          { id: 3, projectId: 10, name: 'QA', baseUrl: 'https://qa.example.test', enabled: true },
        ]),
      } as never,
      registry: new NeutralExecutorRegistry(),
    });

    const response = await new AutomationController(app).getEnvironments(request, 10);

    expect(response).toEqual({ items: [{ id: 3, name: 'QA', enabled: true, isDefault: false }] });
  });

  it('keeps API readiness false for a registered executor without queue, worker heartbeat, or phase proof', async () => {
    const registry = new NeutralExecutorRegistry();
    registry.register('fake', {
      execute: vi.fn(),
      cancel: vi.fn(),
      health: vi.fn(async () => ({ key: 'fake', ready: true, status: 'test-only' })),
    });
    const app = createAutomationApplication({
      store: { canAccessProject: vi.fn(async () => true) } as never,
      registry,
    });

    await expect(app.health()).resolves.toMatchObject({ ready: false, status: 'not_ready' });
  });

  it('reports ready only when store, queue, worker heartbeat, phase proof, and an executor are ready', async () => {
    const registry = new NeutralExecutorRegistry();
    const executor = {
      execute: vi.fn(),
      cancel: vi.fn(),
      health: vi.fn(async () => ({ key: 'hercules', ready: true, status: 'ready' })),
    };
    registry.register('hercules', executor);
    const queue = {
      enqueue: vi.fn(),
      cancel: vi.fn(),
      health: vi.fn(async () => ({ ready: true, status: 'ready' })),
    };
    const worker = {
      health: vi.fn(async () => ({
        ready: true,
        status: 'ready',
        heartbeatAt: new Date().toISOString(),
        phase0Ready: true,
        executors: [],
      })),
    };
    const app = createAutomationApplication({
      store: { canAccessProject: vi.fn(async () => true) } as never,
      queue,
      worker,
      registry,
    });

    await expect(app.health()).resolves.toMatchObject({ ready: true, status: 'ready' });
    expect(queue.health).toHaveBeenCalledOnce();
    expect(worker.health).toHaveBeenCalledOnce();
  });

  it('does not trust a worker readiness claim without Phase-0 compatibility proof', async () => {
    const registry = new NeutralExecutorRegistry();
    registry.register('hercules', {
      execute: vi.fn(),
      cancel: vi.fn(),
      health: vi.fn(async () => ({ key: 'hercules', ready: true, status: 'ready' })),
    });
    const app = createAutomationApplication({
      store: { canAccessProject: vi.fn(async () => true) } as never,
      queue: {
        enqueue: vi.fn(),
        cancel: vi.fn(),
        health: vi.fn(async () => ({ ready: true, status: 'ready' })),
      },
      worker: {
        health: vi.fn(async () => ({
          ready: true,
          status: 'ready',
          heartbeatAt: new Date().toISOString(),
          phase0Ready: false,
          executors: [],
        })),
      },
      registry,
    });

    await expect(app.health()).resolves.toMatchObject({ ready: false, status: 'not_ready' });
  });
});
