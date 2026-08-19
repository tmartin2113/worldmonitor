import type {
  ServerContext,
  GetWingbitsStatusRequest,
  GetWingbitsStatusResponse,
} from '../../../../src/generated/server/worldmonitor/military/v1/service_server';
import { answeredDirectly } from '../../../_shared/data-status';

export async function getWingbitsStatus(
  _ctx: ServerContext,
  _req: GetWingbitsStatusRequest,
): Promise<GetWingbitsStatusResponse> {
  // This endpoint fully answers from its own environment — there is no fetch to
  // fail, so it is always OK. `configured: false` is a real answer, not a gap.
  const apiKey = process.env.WINGBITS_API_KEY;
  return {
    configured: !!apiKey,
    dataStatus: answeredDirectly(
      apiKey ? 'WINGBITS_API_KEY is configured' : 'WINGBITS_API_KEY is not set on this deployment',
    ),
  };
}
