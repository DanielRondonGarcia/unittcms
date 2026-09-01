import { describe, expect, it, vi } from 'vitest';
import requestContext from './requestContext.js';

function createResponse() {
  return { setHeader: vi.fn() } as never;
}

describe('request context middleware', () => {
  it('preserves a safe incoming correlation id and echoes it', () => {
    const request = { get: vi.fn(() => 'run-case-42') } as never;
    const response = createResponse();
    const next = vi.fn();

    requestContext(request, response, next);

    expect(request.correlationId).toBe('run-case-42');
    expect(response.setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'run-case-42');
    expect(next).toHaveBeenCalledOnce();
  });

  it('replaces unsafe or missing values with a generated id', () => {
    const request = { get: vi.fn(() => 'bad value\r\n') } as never;
    const response = createResponse();

    requestContext(request, response, vi.fn());

    expect(request.correlationId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(response.setHeader).toHaveBeenCalledWith('X-Correlation-Id', request.correlationId);
  });
});
