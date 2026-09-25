// The name list moved to the backend (ADR 058) so the chart (web) and the
// English answer (src/answer/translate) share ONE list. This file stays as the
// web's import point.
export {
  translateAttributionLine,
  translateMeasureTitle,
  translatePeriodLabel,
  translateRegion,
  translateUnit,
} from '../../backend/registry/english-names.ts';
