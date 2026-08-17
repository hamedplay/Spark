import './auth-modern.css';
import { ThemeProvider } from './context/ThemeContext';
import { GuestJoinPage } from './components/VideoConference/GuestJoinPage';

export default function GuestApplication({ code }: { code: string }) {
  return (
    <ThemeProvider>
      <div className="spark-auth-flow min-h-screen">
        <GuestJoinPage code={code} />
      </div>
    </ThemeProvider>
  );
}
