import { SIDE_PANEL_CONSTRAINTS } from '@/side-panel/constants/SidePanelConstraints';
import { createAtomState } from '@/ui/utilities/state/jotai/utils/createAtomState';

export const sidePanelMaxWidthState = createAtomState<number>({
  key: 'sidePanelMaxWidthState',
  defaultValue: SIDE_PANEL_CONSTRAINTS.max,
  useLocalStorage: true,
});
