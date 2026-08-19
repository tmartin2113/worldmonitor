import type {
  ServerContext,
  GetCotPositioningRequest,
  GetCotPositioningResponse,
  CotInstrument,
} from '../../../../src/generated/server/worldmonitor/market/v1/service_server';
import { attach } from '../../../_shared/data-status';

const SEED_CACHE_KEY = 'market:cot:v1';

interface RawInstrument {
  name: string;
  code: string;
  reportDate: string;
  assetManagerLong: number;
  assetManagerShort: number;
  leveragedFundsLong: number;
  leveragedFundsShort: number;
  dealerLong: number;
  dealerShort: number;
  netPct: number;
}

export async function getCotPositioning(
  _ctx: ServerContext,
  _req: GetCotPositioningRequest,
): Promise<GetCotPositioningResponse> {
  return attach(SEED_CACHE_KEY, 'the seeder for get cot positioning has not written this key', (__cachedValue) => {
    const raw = __cachedValue as { instruments?: RawInstrument[]; reportDate?: string } | null;
    if (!raw?.instruments || raw.instruments.length === 0) {
      return { instruments: [], reportDate: '', unavailable: true };
    }

    const instruments: CotInstrument[] = raw.instruments.map(item => ({
      name: String(item.name ?? ''),
      code: String(item.code ?? ''),
      reportDate: String(item.reportDate ?? ''),
      assetManagerLong: String(item.assetManagerLong ?? 0),
      assetManagerShort: String(item.assetManagerShort ?? 0),
      leveragedFundsLong: String(item.leveragedFundsLong ?? 0),
      leveragedFundsShort: String(item.leveragedFundsShort ?? 0),
      dealerLong: String(item.dealerLong ?? 0),
      dealerShort: String(item.dealerShort ?? 0),
      netPct: Number(item.netPct ?? 0),
    }));

    return {
      instruments,
      reportDate: String(raw.reportDate ?? ''),
      unavailable: false,
    };
  });
}
