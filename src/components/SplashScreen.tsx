import React, { useEffect, useState } from 'react';

interface Props {
  onDone: () => void;
}

export function SplashScreen({ onDone }: Props) {
  const [phase, setPhase] = useState<'enter' | 'hold' | 'exit'>('enter');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('hold'), 600);
    const t2 = setTimeout(() => setPhase('exit'), 1800);
    const t3 = setTimeout(() => onDone(), 2400);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center"
      style={{
        background: 'linear-gradient(135deg, #f0f7f0 0%, #e8f5e8 50%, #f5faf5 100%)',
        opacity: phase === 'exit' ? 0 : 1,
        transition: phase === 'exit' ? 'opacity 0.55s ease-in' : 'opacity 0.4s ease-out',
      }}
    >
      <div
        style={{
          transform: phase === 'enter' ? 'scale(0.6) translateY(20px)' : phase === 'exit' ? 'scale(1.08) translateY(-8px)' : 'scale(1) translateY(0px)',
          opacity: phase === 'enter' ? 0 : 1,
          transition: phase === 'enter'
            ? 'transform 0.55s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease-out'
            : phase === 'exit'
            ? 'transform 0.5s ease-in, opacity 0.5s ease-in'
            : 'none',
        }}
        className="flex flex-col items-center gap-4"
      >
        <img
          src="/logo_spark.png"
          alt="Spark"
          className="w-32 h-32 object-contain drop-shadow-xl"
          style={{
            filter: 'drop-shadow(0 8px 24px rgba(107,158,107,0.35))',
          }}
        />
        <div className="text-center" style={{ opacity: phase === 'hold' ? 1 : 0, transition: 'opacity 0.3s ease-out 0.2s' }}>
          <p className="text-2xl font-bold text-[#4a7c59] tracking-wide">اسپارک</p>
          <p className="text-sm text-[#6b9e6b] mt-1 font-medium">سامانه هوشمند مدیریت سازمانی</p>
        </div>
      </div>

      {/* Shimmer ring */}
      <div
        className="absolute rounded-full pointer-events-none"
        style={{
          width: 180,
          height: 180,
          border: '2px solid rgba(107,158,107,0.25)',
          opacity: phase === 'hold' ? 1 : 0,
          transform: phase === 'hold' ? 'scale(1.4)' : 'scale(0.8)',
          transition: 'all 0.6s ease-out 0.3s',
        }}
      />
    </div>
  );
}
