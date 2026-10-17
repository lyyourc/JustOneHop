import { t } from './i18n';
import type { RankingInfo } from './usage';

export function rankingDescription(info: RankingInfo): string {
  return t(info.promoted ? 'rankingPromotedHint' : 'rankingRecordedHint');
}
