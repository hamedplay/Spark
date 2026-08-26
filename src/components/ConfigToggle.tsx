export interface ConfigToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  color?: string;
}

function ToggleBase({ value, onChange, color }: Required<ConfigToggleProps>) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`w-10 h-5 rounded-full relative transition-colors flex-shrink-0 ${value ? color : 'bg-gray-200 dark:bg-gray-600'}`}
    >
      <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${value ? 'translate-x-5' : 'translate-x-0.5'}`} />
    </button>
  );
}

function createConfigToggle(defaultColor: string) {
  return function ConfigToggle({ value, onChange, color = defaultColor }: ConfigToggleProps) {
    return <ToggleBase value={value} onChange={onChange} color={color} />;
  };
}

export const NotificationToggle = createConfigToggle('bg-amber-500');
export const SmsToggle = createConfigToggle('bg-green-500');
