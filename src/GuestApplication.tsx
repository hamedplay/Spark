import { ThemeProvider } from './context/ThemeContext';
import { GuestJoinPage } from './components/VideoConference/GuestJoinPage';

export default function GuestApplication({ code }: { code: string }) {
  return (
    <ThemeProvider>
      <GuestJoinPage code={code} />
    </ThemeProvider>
  );
}
