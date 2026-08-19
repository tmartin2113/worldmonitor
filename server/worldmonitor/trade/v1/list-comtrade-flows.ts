import type {
  ServerContext,
  ListComtradeFlowsRequest,
  ListComtradeFlowsResponse,
  ComtradeFlowRecord,
} from '../../../../src/generated/server/worldmonitor/trade/v1/service_server';
import filterParamContracts from '../../../../shared/openapi-filter-param-contracts.json';
import { getCachedJsonBatch } from '../../../_shared/redis';
import { neverSeeded, upstreamError } from '../../../_shared/data-status';
import { isCallerPremium } from '../../../_shared/premium-check';

const KEY_PREFIX = 'comtrade:flows';

// Strategic reporters and commodities mirrored from the seed script.
const REPORTERS = ['842', '156', '643', '364', '699', '490'];
const CMD_CODES = ['2709', '2711', '7108', '8542', '9301'];
const CMD_CODE_RE = new RegExp(filterParamContracts.tradeComtradeCmdCodePattern);

function isValidCode(c: string): boolean {
  return /^\d{1,10}$/.test(c);
}

export async function listComtradeFlows(
  ctx: ServerContext,
  req: ListComtradeFlowsRequest,
): Promise<ListComtradeFlowsResponse> {
  const isPro = await isCallerPremium(ctx.request);
  // Entitlement, not an upstream outage — this path set upstreamUnavailable,
  // which told the caller the source was down when nothing was even queried.
  if (!isPro) {
    return {
      flows: [], fetchedAt: '', upstreamUnavailable: true,
      dataStatus: neverSeeded('Comtrade flows require a premium caller; no lookup was performed'),
    };
  }

  try {
    const reporters = req.reporterCode && isValidCode(req.reporterCode) ? [req.reporterCode] : REPORTERS;
    const cmdCodes = req.cmdCode && CMD_CODE_RE.test(req.cmdCode) ? [req.cmdCode] : CMD_CODES;

    const keys = reporters.flatMap((r) => cmdCodes.map((c) => `${KEY_PREFIX}:${r}:${c}`));
    const batch = await getCachedJsonBatch(keys);

    const flows: ComtradeFlowRecord[] = [];
    let fetchedAt = '';
    let dataFound = false;

    for (const result of batch.values()) {
      if (!result) continue;
      dataFound = true;
      const records = Array.isArray(result) ? result : (result as { flows?: ComtradeFlowRecord[]; fetchedAt?: string }).flows ?? [];
      if (!fetchedAt && (result as { fetchedAt?: string }).fetchedAt) {
        fetchedAt = (result as { fetchedAt: string }).fetchedAt;
      }
      for (const r of records) {
        if (req.anomaliesOnly && !r.isAnomaly) continue;
        flows.push(r as ComtradeFlowRecord);
      }
    }

    const found = [...batch.values()].filter(Boolean).length;
    if (!dataFound) {
      return {
        flows: [], fetchedAt, upstreamUnavailable: true,
        dataStatus: neverSeeded(`none of the ${keys.length} Comtrade reporter/commodity keys has been written`),
      };
    }

    flows.sort((a, b) => b.year - a.year || Math.abs(b.yoyChange) - Math.abs(a.yoyChange));

    return {
      flows, fetchedAt, upstreamUnavailable: false,
      // A batch that returned some keys and not others is PARTIAL — reporting OK
      // would let a handful of present keys vouch for the whole matrix.
      dataStatus: found < keys.length
        ? { fetchedAt: '0', availability: 'DATA_AVAILABILITY_PARTIAL',
            detail: `${keys.length - found} of ${keys.length} reporter/commodity keys missing; the rest were read normally` }
        : { fetchedAt: '0', availability: 'DATA_AVAILABILITY_OK', detail: '' },
    };
  } catch (err) {
    return { flows: [], fetchedAt: '', upstreamUnavailable: true, dataStatus: upstreamError(err, 'Comtrade batch read failed') };
  }
}
