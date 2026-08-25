export default function BoardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style>{`
        body {
          margin: 0 !important;
          padding: 0 !important;
          min-height: 0 !important;
          background: #fafaf9 !important;
        }
        .site-nav-bar {
          display: none !important;
        }
      `}</style>
      {children}
    </>
  );
}
