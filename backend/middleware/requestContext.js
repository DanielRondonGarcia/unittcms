import { randomUUID } from 'node:crypto';

const CORRELATION_HEADER = 'X-Correlation-Id';
const CORRELATION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function getCorrelationId(req) {
  const candidate = req.get(CORRELATION_HEADER)?.trim();
  return candidate && CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

export default function requestContext(req, res, next) {
  const correlationId = getCorrelationId(req);
  req.correlationId = correlationId;
  res.setHeader(CORRELATION_HEADER, correlationId);
  next();
}
