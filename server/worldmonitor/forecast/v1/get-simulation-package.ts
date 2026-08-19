import type {
  ForecastServiceHandler,
  ServerContext,
  GetSimulationPackageRequest,
  GetSimulationPackageResponse,
} from '../../../../src/generated/server/worldmonitor/forecast/v1/service_server';
import { readSeeded, answeredDirectly } from '../../../_shared/data-status';
import { markNoCacheResponse } from '../../../_shared/response-headers';
import { SIMULATION_PACKAGE_LATEST_KEY } from '../../../_shared/cache-keys';

type PackagePointer = { runId: string; pkgKey: string; schemaVersion: string; theaterCount: number; generatedAt: number };

function isPackagePointer(v: unknown): v is PackagePointer {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return typeof o['runId'] === 'string' && typeof o['pkgKey'] === 'string'
    && typeof o['schemaVersion'] === 'string' && typeof o['theaterCount'] === 'number'
    && typeof o['generatedAt'] === 'number';
}

const NOT_FOUND: GetSimulationPackageResponse = {
  found: false, runId: '', pkgKey: '', schemaVersion: '', theaterCount: 0, generatedAt: 0, note: '', error: '',
};

export const getSimulationPackage: ForecastServiceHandler['getSimulationPackage'] = async (
  ctx: ServerContext,
  req: GetSimulationPackageRequest,
): Promise<GetSimulationPackageResponse> => {
  const read = await readSeeded(SIMULATION_PACKAGE_LATEST_KEY,
    'no simulation package has been published yet');
  if (read.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR') {
    markNoCacheResponse(ctx.request); // don't cache error state
    return { ...NOT_FOUND, error: 'redis_unavailable', dataStatus: read.status };
  }

  const pointer = isPackagePointer(read.data) ? read.data : null;
  if (!pointer?.pkgKey) {
    markNoCacheResponse(ctx.request); // don't cache not-found — package may appear soon after a deep run
    // Not-found is a real answer here; the pointer key simply has not been
    // written since the last deep run. Distinct from "Redis was unreachable",
    // which the branch above now reports separately.
    return { ...NOT_FOUND, dataStatus: read.status };
  }
  const note = req.runId && req.runId !== pointer.runId
    ? 'runId filter not yet active; returned package may differ from requested run'
    : '';
  return { found: true, runId: pointer.runId, pkgKey: pointer.pkgKey, schemaVersion: pointer.schemaVersion, theaterCount: pointer.theaterCount, generatedAt: pointer.generatedAt, note, error: '', dataStatus: answeredDirectly() };
};
