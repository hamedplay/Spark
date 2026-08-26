export function RoomBackground() {
  return (
    <>
      <style>{`
        @keyframes float-up{0%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-120px) scale(1.5)}}
        @keyframes tile-reaction{0%{opacity:0;transform:scale(0.5)}15%{opacity:1;transform:scale(1.2)}30%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:scale(0.8)}}
        .conf-panel-mobile{transition:transform 0.3s cubic-bezier(.4,0,.2,1)}
      `}</style>
      {/* Background image — pointer-events-none so it never interferes with video tiles or controls */}
      <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
        <img
          src="/pexels-photo-4226140.jpg"
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover opacity-[0.07] blur-sm"
        />
        <div className="absolute inset-0 bg-gray-950/80" />
      </div>
    </>
  );
}
