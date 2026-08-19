import type {
  ServerContext,
  GetBypassOptionsRequest,
  GetBypassOptionsResponse,
  BypassOption,
  ChokepointInfo,
} from '../../../../src/generated/server/worldmonitor/supply_chain/v1/service_server';

import { isCallerPremium } from '../../../_shared/premium-check';
import { BYPASS_CORRIDORS_BY_CHOKEPOINT } from '../../../../src/config/bypass-corridors';
import { readSeeded, answeredDirectly } from '../../../_shared/data-status';
import { CHOKEPOINT_STATUS_KEY } from '../../../_shared/cache-keys';
import { TIER_RANK } from './_insurance-tier';

// Scoring: disruption risk dominates (60%), cost premium secondary (40%).
// Risk: 0-100 from disruptionScore. Cost: 0-55 from addedCostMultiplier (max ~1.55 → 55pts).
const SCORE_RISK_WEIGHT = 0.6;
const SCORE_COST_WEIGHT = 0.4;

export async function getBypassOptions(
  ctx: ServerContext,
  req: GetBypassOptionsRequest,
): Promise<GetBypassOptionsResponse> {
  const isPro = await isCallerPremium(ctx.request);
  const empty: GetBypassOptionsResponse = {
    chokepointId: req.chokepointId,
    cargoType: req.cargoType || 'container',
    closurePct: req.closurePct ?? 100,
    options: [],
    primaryChokepointWarRiskTier: 'WAR_RISK_TIER_UNSPECIFIED',
    fetchedAt: new Date().toISOString(),
  };
  if (!isPro) return empty;

  const chokepointId = req.chokepointId?.trim().toLowerCase();
  if (!chokepointId) return empty;

  const cargoType = (req.cargoType?.trim().toLowerCase() || 'container') as 'container' | 'tanker' | 'bulk' | 'roro';
  const closurePct = Math.max(0, Math.min(100, req.closurePct ?? 100));

  const corridors = BYPASS_CORRIDORS_BY_CHOKEPOINT[chokepointId] ?? [];

  const relevant = corridors.filter(c => {
    if (c.suitableCargoTypes.length === 0) return false;
    if (!c.suitableCargoTypes.includes(cargoType)) return false;
    if (closurePct < 100 && c.activationThreshold === 'full_closure') return false;
    return true;
  });

  // `.catch(() => null)` folded a Redis fault into the same null a never-written
  // key gives; without live chokepoint status these scores fall back to static
  // registry values, which is a weaker answer of the same shape.
  const statusRead = await readSeeded<{ chokepoints?: ChokepointInfo[] }>(
    CHOKEPOINT_STATUS_KEY, 'the chokepoint-status key has not been written');
  const statusRaw = statusRead.data;
  const tierMap: Record<string, string> = {};
  const scoreMap: Record<string, number> = {};
  for (const cp of statusRaw?.chokepoints ?? []) {
    if (cp.warRiskTier) tierMap[cp.id] = cp.warRiskTier;
    if (typeof cp.disruptionScore === 'number') scoreMap[cp.id] = cp.disruptionScore;
  }

  const primaryChokepointWarRiskTier = (tierMap[chokepointId] ?? 'WAR_RISK_TIER_UNSPECIFIED') as BypassOption['bypassWarRiskTier'];

  const options: BypassOption[] = relevant.map(c => {
    const waypointScores = c.waypointChokepointIds.map(id => scoreMap[id] ?? 0);
    const avgWaypointScore = waypointScores.length > 0
      ? waypointScores.reduce((a, b) => a + b, 0) / waypointScores.length
      : 0;
    const liveScore = Math.max(0, Math.min(100,
      avgWaypointScore * SCORE_RISK_WEIGHT + (c.addedCostMultiplier - 1) * 100 * SCORE_COST_WEIGHT
    ));

    const maxTierKey = c.waypointChokepointIds.reduce<string>((best, id) => {
      const t = tierMap[id] ?? 'WAR_RISK_TIER_UNSPECIFIED';
      return (TIER_RANK[t] ?? 0) > (TIER_RANK[best] ?? 0) ? t : best;
    }, 'WAR_RISK_TIER_UNSPECIFIED');

    return {
      id: c.id,
      name: c.name,
      type: c.type,
      addedTransitDays: c.addedTransitDays,
      addedCostMultiplier: c.addedCostMultiplier,
      capacityConstraintTonnage: String(c.capacityConstraintTonnage ?? 0),
      suitableCargoTypes: [...c.suitableCargoTypes],
      activationThreshold: c.activationThreshold,
      waypointChokepointIds: [...c.waypointChokepointIds],
      liveScore: Math.round(liveScore * 10) / 10,
      bypassWarRiskTier: maxTierKey as BypassOption['bypassWarRiskTier'],
      notes: c.notes,
    };
  });

  options.sort((a, b) => a.liveScore - b.liveScore);

  return {
    chokepointId,
    cargoType,
    closurePct,
    options,
    primaryChokepointWarRiskTier,
    fetchedAt: new Date().toISOString(),
    dataStatus: statusRaw
      ? answeredDirectly()
      : statusRead.status.availability === 'DATA_AVAILABILITY_UPSTREAM_ERROR'
        ? statusRead.status
        : { fetchedAt: '0', availability: 'DATA_AVAILABILITY_PARTIAL',
            detail: 'live chokepoint status was unavailable; bypass scores use static registry values only' },
  };
}
