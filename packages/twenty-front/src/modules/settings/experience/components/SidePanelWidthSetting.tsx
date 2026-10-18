import { sidePanelMaxWidthState } from '@/side-panel/states/SidePanelMaxWidthState';
import { sidePanelWidthState } from '@/side-panel/states/sidePanelWidthState';
import { Select } from '@/ui/input/components/Select';
import { useAtomState } from '@/ui/utilities/state/jotai/hooks/useAtomState';
import { useLingui } from '@lingui/react/macro';

export const SidePanelWidthSetting = () => {
  const { t } = useLingui();
  const [sidePanelMaxWidth, setSidePanelMaxWidth] = useAtomState(
    sidePanelMaxWidthState,
  );

  const [, setSidePanelWidth] = useAtomState(sidePanelWidthState);

  const handleChange = (step: number) => {
    setSidePanelMaxWidth(step);
    setSidePanelWidth(step - 200);
  };

  return (
    <Select
      dropdownId="number-format-select"
      dropdownWidth={218}
      label={t`Number format`}
      dropdownWidthAuto
      fullWidth
      value={sidePanelMaxWidth}
      pinnedOption={{
        label: t`System settings`,
        value: 600,
      }}
      options={[
        {
          label: t`Small Sidebar`,
          value: 400,
        },
        {
          label: t`Super small Sidebar`,
          value: 300,
        },
        {
          label: t`Big Sidebar`,
          value: 750,
        },
        {
          label: t`Super big Sidebar`,
          value: 900,
        },
      ]}
      onChange={handleChange}
    />
  );
};
